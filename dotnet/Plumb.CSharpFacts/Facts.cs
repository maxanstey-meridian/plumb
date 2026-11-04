namespace Plumb.CSharpFacts;

// How a use's type name appears where it's written (Written in the capability's output, by this order).
enum Written { Qualified = 0, Enclosing = 1, Imported = 2, None = 3 }

readonly record struct TypePart(
    string Name,
    string Kind,
    string Namespace,
    string? Containing,
    string Access,
    string Assembly,
    IReadOnlyList<string> BaseTypes,
    int Start,
    int End,
    IReadOnlyList<string>? Frameworks = null);

readonly record struct UsingFact(
    int Start,
    bool Global,
    bool Static,
    string? Alias,
    string Target,
    string TargetKind,
    string? Type,
    string? Assembly,
    bool External,
    IReadOnlyList<TypeRef>? Arguments = null);

// A named type by its name and the assembly the compiler bound it to.
readonly record struct TypeRef(string Type, string Assembly);

readonly record struct ReferenceFact(
    int Start,
    int End,
    string? From,
    string? FromMember,
    string To,
    string Assembly,
    string? Member,
    Written Written,
    bool Qualifier,
    bool External,
    string Namespace);

readonly record struct TableFact(int Start, string Method, string? Schema, string Table);

readonly record struct SnapshotTableFact(int Start, string Entity, string Method, string? Schema, string Table);

readonly record struct DefaultSchemaFact(int Start, string Schema);

// What one document yields. Each walk owns one, so documents are walked in parallel; a file that several target
// frameworks compile yields one per framework, and they are merged into one before the files are put in path order.
sealed class DocumentFacts(string file, string assembly)
{
    public string File { get; } = file;
    public string Assembly { get; } = assembly;
    public List<TypePart> Parts { get; } = [];
    public List<UsingFact> Usings { get; } = [];
    public List<ReferenceFact> References { get; } = [];
    public List<TableFact> Tables { get; } = [];
    public List<SnapshotTableFact> SnapshotTables { get; } = [];
    public List<DefaultSchemaFact> DefaultSchemas { get; } = [];

    static readonly string[] WidestFirst = ["public", "protected internal", "internal", "protected", "private protected", "private", "file"];

    // One multi-target project's documents, each with its framework's name, first framework first. A type's access, kind,
    // and bases can differ by framework: it's as visible as its widest, it's an interface if any framework says so
    // (otherwise each part keeps its own kind, the first framework's), and it has all of its bases. Each part lists the
    // frameworks whose documents hold it (one name, assembly, file, start, and end), in the order given, so a reader can
    // tell the declarations of one name that are alternatives under #if from those that compile together. A single-target
    // project never comes here, and its parts list none. Every part of a name takes the namespace and containing type of
    // the first framework's (`frameworks` is the project's, first first), as the facts can hold only those. It returns the
    // names, ordinally sorted, whose namespace and containing type differ by framework: a framework that doesn't declare
    // a name isn't a difference.
    public static IReadOnlyList<string> Reconcile(IReadOnlyList<(DocumentFacts Document, string Framework)> documents, IReadOnlyList<string> frameworks)
    {
        var order = frameworks.ToList();
        var types = documents
            .SelectMany(entry => entry.Document.Parts.Select(part => (Part: part, Rank: order.IndexOf(entry.Framework))))
            .GroupBy(declared => (declared.Part.Name, declared.Part.Assembly))
            .ToDictionary(type => type.Key, type =>
            {
                var first = type.MinBy(declared => declared.Rank).Part;
                return (
                    Access: type.Select(declared => declared.Part.Access).MinBy(access => Array.IndexOf(WidestFirst, access))!,
                    Kind: type.Any(declared => declared.Part.Kind == "interface") ? "interface" : first.Kind,
                    first.Namespace,
                    first.Containing,
                    BaseTypes: (IReadOnlyList<string>)type.SelectMany(declared => declared.Part.BaseTypes).Distinct(StringComparer.Ordinal).ToList());
            });
        var differing = documents
            .SelectMany(entry => entry.Document.Parts.Select(part => (part.Name, part.Assembly, Place: (part.Namespace, part.Containing))))
            .GroupBy(declared => (declared.Name, declared.Assembly))
            .Where(type => type.Select(declared => declared.Place).Distinct().Count() > 1)
            .Select(type => type.Key.Name)
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();
        var declaring = new Dictionary<(string Name, string Assembly, string File, int Start, int End), List<string>>();
        foreach (var (document, framework) in documents)
        {
            foreach (var part in document.Parts)
            {
                var key = (part.Name, part.Assembly, document.File, part.Start, part.End);
                if (!declaring.TryGetValue(key, out var holding))
                {
                    holding = [];
                    declaring[key] = holding;
                }
                if (!holding.Contains(framework))
                {
                    holding.Add(framework);
                }
            }
        }
        foreach (var (document, _) in documents)
        {
            for (var index = 0; index < document.Parts.Count; index++)
            {
                var part = document.Parts[index];
                var type = types[(part.Name, part.Assembly)];
                var declared = declaring[(part.Name, part.Assembly, document.File, part.Start, part.End)];
                document.Parts[index] = part with { Kind = type.Kind, Namespace = type.Namespace, Containing = type.Containing, Access = type.Access, BaseTypes = type.BaseTypes, Frameworks = declared };
            }
        }
        return differing;
    }

    // One file's facts over the frameworks that compile it, in the order given, each fact once.
    public static DocumentFacts Merge(IReadOnlyList<DocumentFacts> frameworks)
    {
        if (frameworks.Count == 1)
        {
            return frameworks[0];
        }
        var merged = new DocumentFacts(frameworks[0].File, frameworks[0].Assembly);
        merged.Parts.AddRange(frameworks.SelectMany(framework => framework.Parts).DistinctBy(part => (part.Name, part.Start, part.End, part.Assembly)));
        // An outside type's assembly differs by framework (System.Runtime, netstandard), and it's still one use, so it's left out
        // of the identity. An in-repo type's is its project file, the same under every framework, and two frameworks can bind
        // one name to two projects, so it stays.
        // The arguments are a list, which compares by reference, so they're left out of the identity and every framework's are
        // kept: a framework can bind an argument that another doesn't.
        merged.Usings.AddRange(frameworks.SelectMany(framework => framework.Usings)
            .GroupBy(fact => fact with { Assembly = fact.External ? null : fact.Assembly, Arguments = null })
            .Select(group => group.First() with { Arguments = group.SelectMany(fact => fact.Arguments ?? []).Distinct().ToList() is { Count: > 0 } union ? union : null }));
        merged.References.AddRange(frameworks.SelectMany(framework => framework.References).DistinctBy(fact => fact with { Assembly = fact.External ? "" : fact.Assembly }));
        merged.Tables.AddRange(frameworks.SelectMany(framework => framework.Tables).Distinct());
        merged.SnapshotTables.AddRange(frameworks.SelectMany(framework => framework.SnapshotTables).Distinct());
        merged.DefaultSchemas.AddRange(frameworks.SelectMany(framework => framework.DefaultSchemas).Distinct());
        return merged;
    }
}

sealed class ProjectEntry(string path)
{
    public string Path { get; } = path;
    public bool Loaded { get; set; } = true;
    public List<string> Messages { get; } = [];

    public void Fail(string message)
    {
        Loaded = false;
        Note(message);
    }

    // A message about a project that still gives its facts.
    public void Note(string message)
    {
        if (!Messages.Contains(message))
        {
            Messages.Add(message);
        }
    }
}

sealed class Options
{
    public string Root { get; init; } = "";
    public string Out { get; init; } = "";
    public List<string> External { get; } = [];
    public List<string> Segments { get; } = [];
    public List<string> Projects { get; } = [];
    public HashSet<string> RepoFiles { get; } = new(StringComparer.Ordinal);
}
