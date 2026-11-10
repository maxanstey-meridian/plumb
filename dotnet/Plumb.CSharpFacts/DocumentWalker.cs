using System.Collections.Concurrent;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Plumb.CSharpFacts;

// Walks one document's syntax tree with its semantic model and records what it uses: every name the
// model binds and every expression's type, the using directives, the declared types, and the table
// mappings.
internal sealed partial class DocumentWalker : CSharpSyntaxWalker
{
    private const string DbContext = "Microsoft.EntityFrameworkCore.DbContext";
    private const string Migration = "Microsoft.EntityFrameworkCore.Migrations.Migration";
    private const string ModelSnapshot =
        "Microsoft.EntityFrameworkCore.Infrastructure.ModelSnapshot";
    private const string ModelBuilder = "Microsoft.EntityFrameworkCore.ModelBuilder";
    private const string EntityTypeBuilderNamespace =
        "Microsoft.EntityFrameworkCore.Metadata.Builders";
    private const string TableAttribute =
        "System.ComponentModel.DataAnnotations.Schema.TableAttribute";

    // What a type declaration tells the uses inside it: its name, and what its base types say it
    // is.
    private sealed record TypeContext(
        string? Name,
        bool PersistenceRoot,
        bool Migrations,
        bool Snapshot
    );

    private static readonly ConcurrentDictionary<
        INamedTypeSymbol,
        (bool Root, bool Migrations, bool Snapshot)
    > _kinds = new(SymbolEqualityComparer.Default);

    private readonly SemanticModel _model;
    private readonly TypeFilter _filter;
    private readonly DocumentFacts _facts;
    private readonly int _bom;
    private readonly Solution _solution;
    private readonly string _root;
    private readonly bool _declarationsOnly;
    private readonly Stack<TypeContext> _types = new();
    private readonly HashSet<ReferenceFact> _seen = [];
    private string? _member;

    private DocumentWalker(
        SemanticModel model,
        TypeFilter filter,
        DocumentFacts facts,
        int bom,
        Solution solution,
        string root,
        bool declarationsOnly
    )
    {
        _model = model;
        _filter = filter;
        _facts = facts;
        _bom = bom;
        _solution = solution;
        _root = root;
        _declarationsOnly = declarationsOnly;
    }

    // `declarationsOnly` records the type declarations (the parts) and nothing else: no usings,
    // references, or tables. It is for a linking project's copy of a file: it is walked for its
    // declarations (its parts, under this project's own defines and frameworks), and its usings,
    // references, and tables are not recorded.
    public static void Walk(
        SyntaxTree tree,
        SemanticModel model,
        TypeFilter filter,
        DocumentFacts facts,
        int bom,
        Solution solution,
        string root,
        bool declarationsOnly
    )
    {
        var walker = new DocumentWalker(
            model,
            filter,
            facts,
            bom,
            solution,
            root,
            declarationsOnly
        );
        walker.Visit(tree.GetRoot());
    }

    private TypeContext? Current => _types.Count == 0 ? null : _types.Peek();

    public override void Visit(SyntaxNode? node)
    {
        switch (node)
        {
            case null:
                return;
            // Declarations only: a type declaration lives in the compilation unit, a namespace, or
            // another type, so the walk goes no further (a using directive, a member, a statement,
            // and an attribute are all skipped here).
            case not (
                CompilationUnitSyntax
                or BaseNamespaceDeclarationSyntax
                or BaseTypeDeclarationSyntax
                or DelegateDeclarationSyntax
            ) when _declarationsOnly:
                return;
            case UsingDirectiveSyntax directive:
                RecordUsing(directive);
                return;
            case BaseNamespaceDeclarationSyntax @namespace:
                // The namespace's own name is no use of a type.
                foreach (var child in @namespace.Externs)
                {
                    Visit(child);
                }
                foreach (var child in @namespace.Usings)
                {
                    Visit(child);
                }
                foreach (var child in @namespace.Members)
                {
                    Visit(child);
                }
                return;
            case BaseTypeDeclarationSyntax
            or DelegateDeclarationSyntax when !node.IsKind(SyntaxKind.ExtensionBlockDeclaration):
                VisitDeclaredType(node);
                return;
            case FieldDeclarationSyntax or EventFieldDeclarationSyntax:
                VisitInMember(node, FieldName(node));
                return;
            case VariableDeclaratorSyntax declarator
                when declarator.Parent?.Parent
                    is FieldDeclarationSyntax
                        or EventFieldDeclarationSyntax:
                VisitInMember(node, declarator.Identifier.Text);
                return;
            case MethodDeclarationSyntax
            or PropertyDeclarationSyntax
            or IndexerDeclarationSyntax
            or EventDeclarationSyntax
            or ConstructorDeclarationSyntax
            or DestructorDeclarationSyntax
            or OperatorDeclarationSyntax
            or ConversionOperatorDeclarationSyntax:
                VisitInMember(node, MemberName(node));
                return;
        }
        Process(node);
        base.Visit(node);
    }

    private void VisitInMember(SyntaxNode node, string? name)
    {
        var outer = _member;
        _member = name;
        Process(node);
        base.Visit(node);
        _member = outer;
    }

    private void VisitDeclaredType(SyntaxNode node)
    {
        var symbol = _model.GetDeclaredSymbol(node) as INamedTypeSymbol;
        var outerMember = _member;
        _member = null;
        if (symbol is not null)
        {
            RecordPart(node, symbol);
            var kind = KindOf(symbol);
            var parent = Current;
            _types.Push(
                new TypeContext(
                    Names.Type(symbol),
                    kind.Root,
                    kind.Migrations || parent is { Migrations: true },
                    kind.Snapshot || parent is { Snapshot: true }
                )
            );
        }
        else
        {
            _types.Push(Current ?? new TypeContext(null, false, false, false));
        }
        Process(node);
        base.Visit(node);
        _types.Pop();
        _member = outerMember;
    }

    private static (bool Root, bool Migrations, bool Snapshot) KindOf(INamedTypeSymbol symbol)
    {
        return _kinds.GetOrAdd(
            symbol,
            static type =>
            {
                bool root = false,
                    migration = false,
                    snapshot = false;
                for (var current = type; current is not null; current = current.BaseType)
                {
                    var name = Names.Type(current.OriginalDefinition);
                    root |= name == DbContext;
                    migration |= name == Migration;
                    snapshot |= name == ModelSnapshot;
                }
                return (root, migration || snapshot, snapshot);
            }
        );
    }

    private string? FieldName(SyntaxNode node)
    {
        var declaration = node switch
        {
            FieldDeclarationSyntax field => field.Declaration,
            EventFieldDeclarationSyntax @event => @event.Declaration,
            _ => null,
        };
        return declaration?.Variables.FirstOrDefault()?.Identifier.Text;
    }

    private string? MemberName(SyntaxNode node)
    {
        return node switch
        {
            MethodDeclarationSyntax method => method.Identifier.Text,
            PropertyDeclarationSyntax property => property.Identifier.Text,
            EventDeclarationSyntax @event => @event.Identifier.Text,
            _ => _model.GetDeclaredSymbol(node)?.Name,
        };
    }

    private int Offset(int position)
    {
        return position + _bom;
    }

    private void Process(SyntaxNode node)
    {
        // Every fact but a part is recorded from here (a reference, a table, a snapshot table, a
        // default schema).
        if (_declarationsOnly)
        {
            return;
        }
        if (node is SimpleNameSyntax name)
        {
            RecordName(name);
        }
        if (node is ExpressionSyntax expression)
        {
            RecordExpression(expression);
        }
        if (node is InvocationExpressionSyntax invocation)
        {
            RecordInvocation(invocation);
        }
        else if (node is AttributeSyntax attribute)
        {
            RecordTableAttribute(attribute);
        }
    }

    private void RecordPart(SyntaxNode node, INamedTypeSymbol symbol)
    {
        var keyword = node switch
        {
            TypeDeclarationSyntax type => type.Keyword,
            EnumDeclarationSyntax @enum => @enum.EnumKeyword,
            DelegateDeclarationSyntax @delegate => @delegate.DelegateKeyword,
            _ => default,
        };
        var kind = symbol.IsRecord
            ? "record"
            : symbol.TypeKind switch
            {
                TypeKind.Struct => "struct",
                TypeKind.Interface => "interface",
                TypeKind.Enum => "enum",
                TypeKind.Delegate => "delegate",
                _ => "class",
            };
        var access = symbol.IsFileLocal
            ? "file"
            : symbol.DeclaredAccessibility switch
            {
                Accessibility.Public => "public",
                Accessibility.Protected => "protected",
                Accessibility.ProtectedOrInternal => "protected internal",
                Accessibility.ProtectedAndInternal => "private protected",
                Accessibility.Private => "private",
                _ => "internal",
            };
        var baseTypes = new List<string>();
        for (var current = symbol.BaseType; current is not null; current = current.BaseType)
        {
            baseTypes.Add(Names.Type(current.OriginalDefinition));
        }
        foreach (var @interface in symbol.AllInterfaces)
        {
            baseTypes.Add(Names.Type(@interface.OriginalDefinition));
        }
        _facts.Parts.Add(
            new TypePart(
                Names.Type(symbol),
                kind,
                Names.Namespace(symbol.ContainingNamespace),
                symbol.ContainingType is { } outer ? Names.Type(outer) : null,
                access,
                _facts.Assembly,
                baseTypes,
                Offset(keyword.SpanStart),
                Offset(node.Span.End)
            )
        );
    }

    private void RecordUsing(UsingDirectiveSyntax directive)
    {
        var alias = directive.Alias?.Name.Identifier.Text;
        ISymbol? target = alias is null
            ? _model.GetSymbolInfo(directive.NamespaceOrType).Symbol
            : (_model.GetDeclaredSymbol(directive) as IAliasSymbol)?.Target;
        string text;
        string kind;
        string? type = null;
        string? assembly = null;
        var external = false;
        List<TypeRef>? arguments = null;
        switch (target)
        {
            case INamespaceSymbol @namespace:
                text = Names.Target(@namespace);
                kind = "namespace";
                break;
            case ITypeSymbol { TypeKind: not TypeKind.Error } resolved:
                text = Names.Target(resolved);
                kind = "type";
                if (resolved is INamedTypeSymbol named)
                {
                    type = Names.Type(named.OriginalDefinition);
                    assembly = Names.Assembly(named.ContainingAssembly, _solution, _root);
                    external = !Names.IsProject(named.ContainingAssembly, _solution, _root);
                }
                // The types inside the target: when it is a plain named type, the type arguments of
                // it and of each type it is nested in (`Dictionary<Thing, int>.KeyCollection` holds
                // Thing and int), else every named type in it (an array's element, a tuple's
                // elements, a nullable's underlying type).
                var inside = IsPlainNamed(resolved)
                    ? ArgumentsOf((INamedTypeSymbol)resolved).SelectMany(NamedTypesIn)
                    : NamedTypesIn(resolved);
                foreach (var inner in inside)
                {
                    if (_filter.OriginOf(inner.OriginalDefinition) == TypeOrigin.Ignored)
                    {
                        continue;
                    }
                    var reference = new TypeRef(
                        Names.Type(inner.OriginalDefinition),
                        Names.Assembly(inner.ContainingAssembly, _solution, _root),
                        _filter.OriginOf(inner.OriginalDefinition) == TypeOrigin.WantedOutside
                    );
                    if (
                        !(arguments ??= []).Any(existing => existing.Identity == reference.Identity)
                    )
                    {
                        arguments.Add(reference);
                    }
                }
                break;
            default:
                // A using that binds nothing is a compiler error, and its project gives no facts.
                return;
        }
        _facts.Usings.Add(
            new UsingFact(
                Offset(directive.SpanStart),
                directive.GlobalKeyword.RawKind != 0,
                directive.StaticKeyword.RawKind != 0,
                alias,
                text,
                kind,
                type,
                assembly,
                external,
                arguments
            )
        );
    }
}
