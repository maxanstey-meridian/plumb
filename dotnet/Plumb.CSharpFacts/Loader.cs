using System.Text.RegularExpressions;
using Microsoft.Build.Logging;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.MSBuild;

namespace Plumb.CSharpFacts;

// Opens each passed project in its own MSBuildWorkspace as it stands, with the build's output going where the project
// puts it, and keeps every project of every reference closure, each target framework included.
sealed partial class Loader : IDisposable
{
    static readonly Regex ProjectFile = ProjectFileRegex();

    readonly Options options;
    readonly string temp;
    readonly List<MSBuildWorkspace> workspaces = [];

    public Loader(Options options, string temp)
    {
        this.options = options;
        this.temp = temp;
    }

    // Project file (absolute) to its entry, and to the projects the workspace built for it (one per target framework, in
    // the workspace's order), for every project seen.
    public Dictionary<string, ProjectEntry> Entries { get; } = new(StringComparer.Ordinal);
    public Dictionary<string, List<Project>> Projects { get; } = new(StringComparer.Ordinal);

    ProjectEntry EntryOf(string path)
    {
        if (!Entries.TryGetValue(path, out var entry))
        {
            entry = new ProjectEntry(path);
            Entries[path] = entry;
        }
        return entry;
    }

    public async Task OpenAllAsync()
    {
        var index = 0;
        foreach (var relative in options.Projects.Distinct())
        {
            var path = Path.GetFullPath(Path.Combine(options.Root, relative));
            EntryOf(path);
            // A project an earlier passed project already references is loaded in that closure.
            if (Projects.ContainsKey(path))
            {
                continue;
            }
            index++;
            await OpenAsync(path, index);
        }
    }

    async Task OpenAsync(string path, int index)
    {
        var workspace = MSBuildWorkspace.Create();
        workspaces.Add(workspace);
        var failures = new List<string>();
        workspace.RegisterWorkspaceFailedHandler(args =>
        {
            // A project may give its frameworks one output path. The workspace keeps every framework and reports the rest
            // as duplicates. That is no failure to load.
            if (args.Diagnostic.Kind == WorkspaceDiagnosticKind.Failure && !args.Diagnostic.Message.StartsWith("Found project with the same file path and output path", StringComparison.Ordinal))
            {
                failures.Add(args.Diagnostic.Message);
            }
        });
        // The build host writes a binary log of the design-time build here (it creates the folder), and it is complete
        // when the open returns. The logs go with the temp folder at exit.
        var binlogs = Path.Combine(temp, index.ToString(), "binlogs");
        Project? opened = null;
        try
        {
            opened = await workspace.OpenProjectAsync(path, new BinaryLogger { Parameters = Path.Combine(binlogs, "build.binlog") });
        }
        catch (Exception error)
        {
            failures.Add(error.Message);
        }

        var closure = new List<Project>();
        if (opened is not null)
        {
            foreach (var project in opened.Solution.Projects)
            {
                if (project.FilePath is null)
                {
                    continue;
                }
                closure.Add(project);
                EntryOf(project.FilePath);
            }
            // A project in two closures keeps the frameworks of the workspace that saw it first.
            foreach (var frameworks in closure.GroupBy(project => project.FilePath!, StringComparer.Ordinal))
            {
                Projects.TryAdd(frameworks.Key, frameworks.ToList());
            }
        }

        var known = new HashSet<string>(closure.Select(project => project.FilePath!), StringComparer.Ordinal) { path };
        var log = BuildLog.Read(binlogs);
        foreach (var failure in failures)
        {
            // A build warning is no failure to load: dropped when MSBuild called exactly this text a warning, and never an error.
            if (log is not null && log.IsWarning(failure))
            {
                continue;
            }
            Attribute(failure, path, known);
            // A build error also fails the project whose build raised it, which the message may not name.
            if (log is not null)
            {
                foreach (var file in log.ErrorFiles(failure))
                {
                    if (file.Length > 0 && known.Contains(file))
                    {
                        EntryOf(file).Fail(failure);
                    }
                }
            }
        }
    }

    // A failure goes to the project reference that failed. Each project file the message names is resolved: an absolute
    // path as it is, a relative one (a reference as the project wrote it) against the folder of the project the message
    // quotes, else the opener's. The failure goes to the named projects whose file doesn't exist; when none is missing,
    // to every named project but the opener; with no other, to the opener.
    void Attribute(string message, string opener, HashSet<string> known)
    {
        var named = new HashSet<string>(StringComparer.Ordinal);
        var relative = new List<string>();
        string? quoting = null;
        foreach (Match match in ProjectFile.Matches(message))
        {
            var written = match.Groups[1].Success ? match.Groups[1].Value : match.Groups[2].Value;
            if (!Path.IsPathRooted(written))
            {
                relative.Add(written);
                continue;
            }
            named.Add(written);
            if (match.Groups[1].Success)
            {
                quoting ??= written;
            }
        }
        var folder = Path.GetDirectoryName(quoting ?? opener)!;
        foreach (var written in relative)
        {
            named.Add(Path.GetFullPath(written, folder));
        }
        foreach (var path in known)
        {
            if (message.Contains(path, StringComparison.Ordinal))
            {
                named.Add(path);
            }
        }
        var missing = named.Where(path => !File.Exists(path)).ToList();
        if (missing.Count > 0)
        {
            named = new HashSet<string>(missing, StringComparer.Ordinal);
        }
        else
        {
            named.Remove(opener);
        }
        if (named.Count == 0)
        {
            EntryOf(opener).Fail(message);
            return;
        }
        foreach (var path in named)
        {
            EntryOf(path).Fail(message);
        }
    }

    [GeneratedRegex(@"'([^']+\.csproj)'|([^\s'""<>|]+\.csproj)")]
    private static partial Regex ProjectFileRegex();

    public void Dispose()
    {
        foreach (var workspace in workspaces)
        {
            workspace.Dispose();
        }
    }
}
