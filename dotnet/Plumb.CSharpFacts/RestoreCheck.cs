using System.ComponentModel;
using System.Diagnostics;
using System.Text.Json;

namespace Plumb.CSharpFacts;

// A project that was never restored opens in the workspace with no error, and names from its packages simply don't bind.
// So every project that loaded is checked against MSBuild's own evaluation of where its restore output should be: the
// SDK's `ProjectAssetsFile`, which follows a repo's BaseIntermediateOutputPath, MSBuildProjectExtensionsPath, and
// artifacts layout. The evaluation alone reads and writes nothing in the repo; opening a project writes its build's output.
static class RestoreCheck
{
    const int Seconds = 60;
    const int AtOnce = 8;
    static readonly (string Name, string Value)[] Environment =
    [
        ("DOTNET_NOLOGO", "1"),
        ("DOTNET_SKIP_FIRST_TIME_EXPERIENCE", "1"),
        ("DOTNET_GENERATE_ASPNET_CERTIFICATE", "false"),
        ("DOTNET_CLI_TELEMETRY_OPTOUT", "1"),
    ];

    sealed record Outcome(bool Started, int Exit, bool TimedOut, string Output, string? Result, string? Error);

    public static async Task RunAsync(string root, Loader loader, string temp)
    {
        var projects = loader.Projects.Keys.Where(project => loader.Entries[project].Loaded).OrderBy(project => project, StringComparer.Ordinal).ToList();
        Directory.CreateDirectory(Path.Combine(temp, "evaluations"));
        var gate = new SemaphoreSlim(AtOnce);
        // MSBuild reports real paths, and a folder such as macOS's /var is a link.
        var real = RealPath(root);
        var verdicts = await Task.WhenAll(projects.Select(async (project, index) =>
        {
            await gate.WaitAsync();
            try
            {
                return await VerdictAsync(real, project, Path.Combine(temp, "evaluations", index.ToString()));
            }
            finally
            {
                gate.Release();
            }
        }));
        for (var index = 0; index < projects.Count; index++)
        {
            if (verdicts[index] is { } message)
            {
                loader.Entries[projects[index]].Fail(message);
            }
        }
    }

    static string RealPath(string path)
    {
        var current = Path.GetPathRoot(path) ?? "/";
        foreach (var segment in path[current.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (new DirectoryInfo(current).ResolveLinkTarget(true) is { } target)
            {
                current = target.FullName;
            }
        }
        return current;
    }

    // null when the project is restored, or has no NuGet restore output to look for.
    static async Task<string?> VerdictAsync(string root, string project, string scratch)
    {
        var read = await EvaluateAsync(project, [], scratch + "-1.json");
        if (read.Properties is null)
        {
            return $"evaluation failed: {await CauseAsync(project, [], read)}";
        }
        var (assets, frameworks) = read.Properties.Value;
        if (assets.Length == 0 && frameworks.Length > 0)
        {
            // A project that sets TargetFrameworks has no assets file in its outer evaluation; there is one per project.
            var extra = new[] { "-p:TargetFramework=" + frameworks[0] };
            read = await EvaluateAsync(project, extra, scratch + "-2.json");
            if (read.Properties is null)
            {
                return $"evaluation failed: {await CauseAsync(project, extra, read)}";
            }
            assets = read.Properties.Value.Assets;
        }
        if (assets.Length == 0 || File.Exists(assets))
        {
            return null;
        }
        return $"not restored: {(Paths.IsUnder(root, assets) ? Paths.Relative(root, assets) : assets)} is missing (run dotnet restore)";
    }

    sealed record Evaluation(Outcome Outcome, (string Assets, string[] Frameworks)? Properties);

    static async Task<Evaluation> EvaluateAsync(string project, string[] extra, string resultFile)
    {
        var outcome = await RunAsync(project, extra, resultFile);
        if (outcome.Started && outcome.Exit == 0 && outcome.Result is not null)
        {
            try
            {
                using var document = JsonDocument.Parse(outcome.Result);
                var properties = document.RootElement.GetProperty("Properties");
                var assets = properties.GetProperty("ProjectAssetsFile").GetString() ?? "";
                var frameworks = (properties.GetProperty("TargetFrameworks").GetString() ?? "")
                    .Split(';')
                    .Select(framework => framework.Trim())
                    .Where(framework => framework.Length > 0)
                    .ToArray();
                return new Evaluation(outcome, (assets, frameworks));
            }
            catch (Exception error) when (error is JsonException or KeyNotFoundException or InvalidOperationException)
            {
            }
        }
        return new Evaluation(outcome, null);
    }

    // With -getResultOutputFile, MSBuild prints nothing when an evaluation fails, so the cause comes from the same call
    // run again without it: its stderr, else its stdout.
    static async Task<string> CauseAsync(string project, string[] extra, Evaluation failed)
    {
        if (!failed.Outcome.Started)
        {
            return failed.Outcome.Error ?? "could not start dotnet";
        }
        var again = await RunAsync(project, extra, null);
        if (!again.Started)
        {
            return again.Error ?? "could not start dotnet";
        }
        var lines = again.Output.Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0).ToList();
        if (lines.Count == 0)
        {
            return again.TimedOut ? $"timed out after {Seconds} s" : $"exit {again.Exit}";
        }
        var errors = lines.Where(line => line.Contains("error", StringComparison.OrdinalIgnoreCase)).ToList();
        var cause = string.Join(' ', errors.Count > 0 ? errors : lines);
        return cause.Length > 400 ? cause[..400] : cause;
    }

    static async Task<Outcome> RunAsync(string project, string[] extra, string? resultFile)
    {
        var start = new ProcessStartInfo("dotnet")
        {
            WorkingDirectory = Path.GetDirectoryName(project)!,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
        };
        foreach (var argument in new[] { "msbuild", Path.GetFileName(project), "-noAutoResponse", "-nologo", "-getProperty:ProjectAssetsFile", "-getProperty:TargetFrameworks" })
        {
            start.ArgumentList.Add(argument);
        }
        foreach (var argument in extra)
        {
            start.ArgumentList.Add(argument);
        }
        if (resultFile is not null)
        {
            start.ArgumentList.Add("-getResultOutputFile:" + resultFile);
        }
        foreach (var (name, value) in Environment)
        {
            start.Environment[name] = value;
        }
        try
        {
            using var process = Process.Start(start)!;
            var standard = process.StandardOutput.ReadToEndAsync();
            var errors = process.StandardError.ReadToEndAsync();
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(Seconds));
            var timedOut = false;
            try
            {
                await process.WaitForExitAsync(timeout.Token);
            }
            catch (OperationCanceledException)
            {
                timedOut = true;
                process.Kill(true);
                await process.WaitForExitAsync();
            }
            var error = await errors;
            var output = string.IsNullOrWhiteSpace(error) ? await standard : error;
            var result = resultFile is not null && File.Exists(resultFile) ? await File.ReadAllTextAsync(resultFile) : null;
            return new Outcome(true, timedOut ? -1 : process.ExitCode, timedOut, output, timedOut ? null : result, null);
        }
        catch (Exception error) when (error is Win32Exception or InvalidOperationException)
        {
            return new Outcome(false, -1, false, "", null, error.Message);
        }
    }
}
