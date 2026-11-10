using Microsoft.Build.Logging;

namespace Plumb.CSharpFacts;

// What MSBuild itself called a warning or an error in a workspace's design-time builds, read from the binary logs the
// build host wrote. The workspace reports every message of a project's MSBuild log as a failure, whatever its severity,
// and carries no severity, so the log is the only place to tell a build warning (a NuGet audit warning, say) from an
// error.
sealed class BuildLog
{
    readonly HashSet<string> warnings = new(StringComparer.Ordinal);
    readonly Dictionary<string, HashSet<string>> errors = new(StringComparer.Ordinal);

    // Every `*.binlog` in the folder (a later build host writes `<name>-<n>.binlog` beside the first), or an empty log for
    // a folder with none. null when a log can't be read: its workspace then has no pairs at all, and every failure goes
    // through attribution as it did before.
    public static BuildLog? Read(string folder)
    {
        var log = new BuildLog();
        if (!Directory.Exists(folder))
        {
            return log;
        }
        try
        {
            foreach (var file in Directory.GetFiles(folder, "*.binlog").Order(StringComparer.Ordinal))
            {
                var source = new BinaryLogReplayEventSource { AllowForwardCompatibility = true };
                source.WarningRaised += (_, warning) => log.warnings.Add(Text(warning.ProjectFile, warning.Message));
                source.ErrorRaised += (_, error) =>
                {
                    var text = Text(error.ProjectFile, error.Message);
                    if (!log.errors.TryGetValue(text, out var files))
                    {
                        files = new HashSet<string>(StringComparer.Ordinal);
                        log.errors[text] = files;
                    }
                    files.Add(error.ProjectFile ?? "");
                };
                source.Replay(file);
            }
        }
        catch (Exception)
        {
            return null;
        }
        return log;
    }

    // The workspace's text for a message of a project's log. Both templates are Roslyn's internal English resources
    // (DiagnosticReporter), held by the exact 5.9.0 pin and InvariantGlobalization; no public member carries the severity.
    static string Text(string? projectFile, string? message)
    {
        return string.IsNullOrWhiteSpace(message)
            ? $"Msbuild failed when processing the file '{projectFile ?? ""}'"
            : $"Msbuild failed when processing the file '{projectFile ?? ""}' with message: {message}";
    }

    // MSBuild called this failure a warning for its project, and never an error.
    public bool IsWarning(string failure)
    {
        return warnings.Contains(failure) && !errors.ContainsKey(failure);
    }

    // The project files of the error events whose text is this failure's.
    public IEnumerable<string> ErrorFiles(string failure)
    {
        return errors.TryGetValue(failure, out var files) ? files : [];
    }
}
