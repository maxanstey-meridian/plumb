using System.Collections.Concurrent;
using System.Text;
using Microsoft.CodeAnalysis;

namespace Plumb.CSharpFacts;

// Full names as every fact writes them: namespaces and containing types joined by `.`, a generic type's arity after a backtick, and a
// file-local type's name prefixed with the compiler's file marker.
static class Names
{
    static readonly ConcurrentDictionary<INamedTypeSymbol, string> TypeNames = new(SymbolEqualityComparer.Default);
    static readonly ConcurrentDictionary<INamespaceSymbol, string> NamespaceNames = new(SymbolEqualityComparer.Default);
    // By reference: two projects with one assembly name can have one assembly identity, and they're still two assemblies.
    static readonly ConcurrentDictionary<IAssemblySymbol, string> AssemblyKeys = new(ReferenceEqualityComparer.Instance);

    static readonly SymbolDisplayFormat TargetFormat = new(
        globalNamespaceStyle: SymbolDisplayGlobalNamespaceStyle.Omitted,
        typeQualificationStyle: SymbolDisplayTypeQualificationStyle.NameAndContainingTypesAndNamespaces,
        genericsOptions: SymbolDisplayGenericsOptions.IncludeTypeParameters,
        miscellaneousOptions: SymbolDisplayMiscellaneousOptions.None);

    // An assembly as every fact keys it: a project's by its project file, relative to the root, so two projects with one
    // assembly name stay two (a multi-target project's frameworks share the file, so they're one); any other by its name.
    public static string Assembly(IAssemblySymbol? assembly, Solution solution, string root)
    {
        if (assembly is null)
        {
            return "";
        }
        return AssemblyKeys.GetOrAdd(assembly, symbol => solution.GetProject(symbol)?.FilePath is { } path ? Paths.Relative(root, path) : symbol.Name);
    }

    public static string Namespace(INamespaceSymbol? ns)
    {
        if (ns is null || ns.IsGlobalNamespace)
        {
            return "";
        }
        return NamespaceNames.GetOrAdd(ns, static symbol =>
        {
            var parent = Namespace(symbol.ContainingNamespace);
            return parent.Length == 0 ? symbol.Name : parent + "." + symbol.Name;
        });
    }

    public static string Type(INamedTypeSymbol type)
    {
        return TypeNames.GetOrAdd(type, static symbol =>
        {
            // A file-local type is its own type, so its name carries the compiler's file marker (`<File>F…__Foo`) and
            // `file class Foo` beside a public `Foo` in one namespace stays two types.
            var name = symbol.IsFileLocal ? symbol.MetadataName : symbol.Arity > 0 ? symbol.Name + "`" + symbol.Arity : symbol.Name;
            if (symbol.ContainingType is { } outer)
            {
                return Type(outer) + "." + name;
            }
            var ns = Namespace(symbol.ContainingNamespace);
            return ns.Length == 0 ? name : ns + "." + name;
        });
    }

    // The same name with each arity marker removed, which the external prefixes and segments are matched against.
    public static string WithoutArity(string name)
    {
        var tick = name.IndexOf('`');
        if (tick < 0)
        {
            return name;
        }
        var result = new StringBuilder(name.Length);
        for (var index = 0; index < name.Length; index++)
        {
            if (name[index] != '`')
            {
                result.Append(name[index]);
                continue;
            }
            while (index + 1 < name.Length && char.IsDigit(name[index + 1]))
            {
                index++;
            }
        }
        return result.ToString();
    }

    // A using's target in C# form: no `global::`, no whitespace, type arguments after a constructed type.
    public static string Target(ISymbol symbol)
    {
        var text = symbol.ToDisplayString(TargetFormat);
        var result = new StringBuilder(text.Length);
        foreach (var character in text)
        {
            if (!char.IsWhiteSpace(character))
            {
                result.Append(character);
            }
        }
        return result.ToString();
    }
}
