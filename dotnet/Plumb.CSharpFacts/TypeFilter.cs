using System.Collections.Concurrent;
using Microsoft.CodeAnalysis;

namespace Plumb.CSharpFacts;

enum TypeOrigin { Source, WantedOutside, Ignored }

// Which types a use is recorded for: every type declared in the repo's own documents, and an outside type only when
// its full name equals an --external prefix or starts with one followed by `.`, or has an --external-segment segment.
// A declaration in what a build generated isn't the repo's own.
sealed class TypeFilter(string root, IReadOnlyList<string> prefixes, IReadOnlyList<string> segments, BuildOutput generated)
{
    readonly ConcurrentDictionary<INamedTypeSymbol, TypeOrigin> cache = new(SymbolEqualityComparer.Default);

    public TypeOrigin OriginOf(INamedTypeSymbol type)
    {
        return cache.GetOrAdd(type, Classify);
    }

    TypeOrigin Classify(INamedTypeSymbol type)
    {
        foreach (var reference in type.DeclaringSyntaxReferences)
        {
            var path = reference.SyntaxTree.FilePath;
            if (Paths.IsUnder(root, path) && !generated.Holds(path))
            {
                return TypeOrigin.Source;
            }
        }
        var name = Names.WithoutArity(Names.Type(type));
        foreach (var prefix in prefixes)
        {
            if (name == prefix || name.StartsWith(prefix + ".", StringComparison.Ordinal))
            {
                return TypeOrigin.WantedOutside;
            }
        }
        if (segments.Count > 0)
        {
            foreach (var segment in name.Split('.'))
            {
                if (segments.Contains(segment))
                {
                    return TypeOrigin.WantedOutside;
                }
            }
        }
        return TypeOrigin.Ignored;
    }
}

// A file in a folder a project builds into, which the repository doesn't hold as its own.
sealed class BuildOutput(string root, IReadOnlyList<string> folders, IReadOnlySet<string> repoFiles)
{
    public bool Holds(string path)
    {
        // A generator's tree can carry MSBuild's backslash off Windows: obj\Debug/net10.0/generated/…
        var file = Path.DirectorySeparatorChar == '/' ? path.Replace('\\', '/') : path;
        return folders.Any(folder => Paths.IsUnder(folder, file)) && !repoFiles.Contains(Paths.Relative(root, file));
    }
}

static class Paths
{
    public static bool IsUnder(string root, string? path)
    {
        return path is not null && path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal);
    }

    public static string Relative(string root, string path)
    {
        return Path.GetRelativePath(root, path).Replace('\\', '/');
    }
}
