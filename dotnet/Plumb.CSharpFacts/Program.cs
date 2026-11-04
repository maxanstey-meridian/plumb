using Microsoft.CodeAnalysis;

namespace Plumb.CSharpFacts;

// Plumb.CSharpFacts --root <dir> --out <file> --repo-files <file> [--external <prefix>]… [--external-segment <name>]… <project>…
//
// Opens each project with MSBuildWorkspace, binds its code, and writes what the code uses as one JSON object to --out.
// It exits 0 even when a project fails to load (the output says so), and non-zero only when the tool itself fails.
static class Program
{
    static async Task<int> Main(string[] args)
    {
        Options options;
        try
        {
            options = Parse(args);
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine(error.Message);
            return 2;
        }
        var temp = Path.Combine(Path.GetTempPath(), "plumb-csharp-facts-" + Guid.NewGuid().ToString("N"));
        try
        {
            Directory.CreateDirectory(temp);
            await RunAsync(options, temp);
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message.Split('\n')[0].Trim());
            Console.Error.WriteLine(error);
            return 1;
        }
        finally
        {
            try
            {
                Directory.Delete(temp, true);
            }
            catch (IOException)
            {
            }
        }
    }

    static Options Parse(string[] args)
    {
        string? root = null;
        string? output = null;
        string? repoFiles = null;
        var external = new List<string>();
        var segments = new List<string>();
        var projects = new List<string>();
        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--root" or "--out" or "--external" or "--external-segment" or "--repo-files":
                    if (index + 1 >= args.Length)
                    {
                        throw new ArgumentException($"{args[index]} needs a value");
                    }
                    var value = args[++index];
                    switch (args[index - 1])
                    {
                        case "--root":
                            root = value;
                            break;
                        case "--out":
                            output = value;
                            break;
                        case "--external":
                            external.Add(value);
                            break;
                        case "--repo-files":
                            repoFiles = value;
                            break;
                        default:
                            segments.Add(value);
                            break;
                    }
                    break;
                default:
                    projects.Add(args[index]);
                    break;
            }
        }
        if (root is null || output is null || repoFiles is null)
        {
            throw new ArgumentException("usage: Plumb.CSharpFacts --root <dir> --out <file> --repo-files <file> [--external <prefix>]… [--external-segment <name>]… <project>…");
        }
        var options = new Options { Root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar), Out = Path.GetFullPath(output) };
        options.RepoFiles.UnionWith(File.ReadAllLines(repoFiles));
        options.External.AddRange(external);
        options.Segments.AddRange(segments);
        options.Projects.AddRange(projects);
        return options;
    }

    static async Task RunAsync(Options options, string temp)
    {
        using var loader = new Loader(options, temp);
        await loader.OpenAllAsync();
        await RestoreCheck.RunAsync(options.Root, loader, temp);

        // What a build generates sits beside what it would build, and isn't source, unless the repository holds it as its own.
        var folders = loader.Projects.Values.SelectMany(frameworks => frameworks)
            .SelectMany(project => new[] { project.CompilationOutputInfo.AssemblyPath, project.OutputFilePath })
            .Select(Path.GetDirectoryName)
            .OfType<string>()
            .Distinct(StringComparer.Ordinal)
            .ToList();
        var generated = new BuildOutput(options.Root, folders, options.RepoFiles);
        var filter = new TypeFilter(options.Root, options.External, options.Segments, generated);
        var documents = Owned(options, loader, generated);

        // Every project's documents are walked at once, the largest first so no big file is left to the end. A project is
        // compiled once per target framework, and the walk is of each framework's documents.
        var projects = documents.Select(owned => owned.Project).DistinctBy(project => project.Id).ToList();
        var compilations = await Task.WhenAll(projects.Select(async project => await project.GetCompilationAsync()
            ?? throw new InvalidOperationException($"no compilation for {project.FilePath}")));
        var compilationOf = projects.Zip(compilations).ToDictionary(pair => pair.First.Id, pair => pair.Second);
        var work = new List<(Document Document, SyntaxTree Tree, Compilation Compilation, Project Project, int Order)>();
        foreach (var owned in documents)
        {
            var tree = await owned.Document.GetSyntaxTreeAsync();
            if (tree is not null)
            {
                work.Add((owned.Document, tree, compilationOf[owned.Project.Id], owned.Project, work.Count));
            }
        }
        // The sort isn't stable and one file has one length under every framework, so Order keeps the frameworks' order.
        work.Sort((left, right) => right.Tree.Length != left.Tree.Length ? right.Tree.Length.CompareTo(left.Tree.Length) : left.Order.CompareTo(right.Order));
        var walked = new DocumentFacts?[work.Count];
        var refused = new List<CompileError>?[work.Count];
        Parallel.For(0, work.Count, index =>
        {
            var (document, tree, compilation, project, _) = work[index];
            var file = Paths.Relative(options.Root, document.FilePath!);
            var facts = new DocumentFacts(file, Names.Assembly(compilation.Assembly, project.Solution, options.Root));
            var model = compilation.GetSemanticModel(tree);
            DocumentWalker.Walk(tree, model, filter, facts, ByteOrderMark(document.FilePath!), project.Solution, options.Root);
            walked[index] = facts;
            // What the compiler calls an error is one: not a warning a project promoted, nor a hidden or info diagnostic
            // an .editorconfig raised.
            refused[index] = model.GetDiagnostics()
                .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error && diagnostic.DefaultSeverity == DiagnosticSeverity.Error)
                .Select(diagnostic => new CompileError(file, diagnostic.Location.GetLineSpan().StartLinePosition.Line + 1, diagnostic.Id, diagnostic.GetMessage().TrimEnd('.')))
                .ToList();
        });

        // A project whose code doesn't compile as the tool loaded it gives no facts: its unbound names would read as types
        // that don't exist, whatever left them unbound (a stale restore, a missing reference, a generator that hasn't run).
        var failed = new HashSet<string>(StringComparer.Ordinal);
        foreach (var group in Enumerable.Range(0, work.Count).GroupBy(index => work[index].Project.FilePath!, StringComparer.Ordinal))
        {
            var errors = group.SelectMany(index => refused[index]!).Distinct()
                .OrderBy(error => error.File, StringComparer.Ordinal)
                .ThenBy(error => error.Line)
                .ThenBy(error => error.Id, StringComparer.Ordinal)
                .ThenBy(error => error.Message, StringComparer.Ordinal)
                .ToList();
            if (errors.Count > 0)
            {
                var first = errors[0];
                var more = errors.Count > 1 ? $" (and {errors.Count - 1} more)" : "";
                loader.Entries[group.Key].Fail($"does not compile: {first.File}:{first.Line} {first.Id}: {first.Message}{more}. Run dotnet build: a stale restore, a missing reference, or a generator that hasn't run leaves names unbound. If it builds already, see Fidelity Boundaries in Plumb's README");
                failed.Add(group.Key);
            }
        }

        // The kept documents, in Owned's order: a multi-target project's are reconciled across its frameworks, then every
        // file's are merged into one set of facts.
        var kept = Enumerable.Range(0, work.Count)
            .Where(index => !failed.Contains(work[index].Project.FilePath!))
            .OrderBy(index => work[index].Order)
            .ToList();
        foreach (var group in kept.GroupBy(index => work[index].Project.FilePath!, StringComparer.Ordinal).Where(group => loader.Projects[group.Key].Count > 1))
        {
            var differing = DocumentFacts.Reconcile(group.Select(index => (walked[index]!, work[index].Project.Name)).ToList());
            if (differing.Count > 0)
            {
                var more = differing.Count > 1 ? $" (and {differing.Count - 1} more)" : "";
                loader.Entries[group.Key].Note($"type {differing[0]} has a different namespace or containing type under each target framework, and the facts hold the first framework's, so a rule can misjudge it{more}");
            }
        }
        var results = kept
            .GroupBy(index => walked[index]!.File, StringComparer.Ordinal)
            .Select(group => DocumentFacts.Merge(group.Select(index => walked[index]!).ToList()))
            .ToList();
        results.Sort((left, right) => string.CompareOrdinal(left.File, right.File));
        FactsWriter.Write(options, loader, results);
    }

    sealed record CompileError(string File, int Line, string Id, string Message);

    // A file's documents, each once per framework, from the project whose folder is nearest above it, ranked over every
    // project the tool knows. A file whose nearest project is `loaded: false` gets no facts, and isn't read from another
    // project that also compiles it. Only when no known project's folder holds a file, or the nearest one doesn't compile
    // it, is it read from the nearest loaded project that does. What a build generated isn't a document.
    static List<(Project Project, Document Document)> Owned(Options options, Loader loader, BuildOutput generated)
    {
        var holders = new Dictionary<string, Dictionary<string, List<(Project Project, Document Document)>>>(StringComparer.Ordinal);
        foreach (var (file, frameworks) in loader.Projects)
        {
            if (!loader.Entries[file].Loaded)
            {
                continue;
            }
            foreach (var project in frameworks)
            {
                foreach (var document in project.Documents)
                {
                    var path = document.FilePath;
                    if (path is null || !path.EndsWith(".cs", StringComparison.Ordinal) || !Paths.IsUnder(options.Root, path) || generated.Holds(path))
                    {
                        continue;
                    }
                    if (!holders.TryGetValue(path, out var holder))
                    {
                        holder = new Dictionary<string, List<(Project, Document)>>(StringComparer.Ordinal);
                        holders[path] = holder;
                    }
                    if (!holder.TryGetValue(file, out var compiled))
                    {
                        compiled = [];
                        holder[file] = compiled;
                    }
                    compiled.Add((project, document));
                }
            }
        }
        var known = loader.Entries.Keys.Select(project => (Project: project, Directory: Path.GetDirectoryName(project)!)).ToList();
        var owned = new List<(Project, Document)>();
        foreach (var (path, holder) in holders)
        {
            var nearestKnown = known
                .Where(candidate => Paths.IsUnder(candidate.Directory, path))
                .OrderByDescending(candidate => candidate.Directory.Length)
                .ThenBy(candidate => candidate.Project, StringComparer.Ordinal)
                .FirstOrDefault();
            if (nearestKnown.Project is not null)
            {
                if (!loader.Entries[nearestKnown.Project].Loaded)
                {
                    continue;
                }
                if (holder.TryGetValue(nearestKnown.Project, out var held))
                {
                    owned.AddRange(held);
                    continue;
                }
            }
            var nearest = holder.Keys
                .OrderByDescending(file => Paths.IsUnder(Path.GetDirectoryName(file)!, path) ? Path.GetDirectoryName(file)!.Length : -1)
                .ThenBy(file => file, StringComparer.Ordinal)
                .First();
            owned.AddRange(holder[nearest]);
        }
        return owned;
    }

    // Plumb reads a file as text and keeps a UTF-8 byte-order mark as a character; Roslyn's source text drops it.
    static int ByteOrderMark(string path)
    {
        using var stream = File.OpenRead(path);
        var head = new byte[3];
        return stream.Read(head, 0, 3) == 3 && head[0] == 0xEF && head[1] == 0xBB && head[2] == 0xBF ? 1 : 0;
    }
}
