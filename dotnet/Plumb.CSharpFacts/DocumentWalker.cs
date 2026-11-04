using System.Collections.Concurrent;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Plumb.CSharpFacts;

// Walks one document's syntax tree with its semantic model and records what it uses: every name the model binds and
// every expression's type, the using directives, the declared types, and the table mappings.
sealed partial class DocumentWalker : CSharpSyntaxWalker
{
    const string DbContext = "Microsoft.EntityFrameworkCore.DbContext";
    const string Migration = "Microsoft.EntityFrameworkCore.Migrations.Migration";
    const string ModelSnapshot = "Microsoft.EntityFrameworkCore.Infrastructure.ModelSnapshot";
    const string ModelBuilder = "Microsoft.EntityFrameworkCore.ModelBuilder";
    const string EntityTypeBuilderNamespace = "Microsoft.EntityFrameworkCore.Metadata.Builders";
    const string TableAttribute = "System.ComponentModel.DataAnnotations.Schema.TableAttribute";

    // What a type declaration tells the uses inside it: its name, and what its base types say it is.
    sealed record TypeContext(string? Name, bool PersistenceRoot, bool Migrations, bool Snapshot);

    static readonly ConcurrentDictionary<INamedTypeSymbol, (bool Root, bool Migrations, bool Snapshot)> Kinds = new(SymbolEqualityComparer.Default);

    readonly SemanticModel model;
    readonly TypeFilter filter;
    readonly DocumentFacts facts;
    readonly int bom;
    readonly Solution solution;
    readonly string root;
    readonly Stack<TypeContext> types = new();
    readonly HashSet<ReferenceFact> seen = [];
    string? member;

    DocumentWalker(SemanticModel model, TypeFilter filter, DocumentFacts facts, int bom, Solution solution, string root)
    {
        this.model = model;
        this.filter = filter;
        this.facts = facts;
        this.bom = bom;
        this.solution = solution;
        this.root = root;
    }

    public static void Walk(SyntaxTree tree, SemanticModel model, TypeFilter filter, DocumentFacts facts, int bom, Solution solution, string root)
    {
        var walker = new DocumentWalker(model, filter, facts, bom, solution, root);
        walker.Visit(tree.GetRoot());
    }

    TypeContext? Current => types.Count == 0 ? null : types.Peek();

    public override void Visit(SyntaxNode? node)
    {
        switch (node)
        {
            case null:
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
            case BaseTypeDeclarationSyntax or DelegateDeclarationSyntax when !node.IsKind(SyntaxKind.ExtensionBlockDeclaration):
                VisitDeclaredType(node);
                return;
            case FieldDeclarationSyntax or EventFieldDeclarationSyntax:
                VisitInMember(node, FieldName(node));
                return;
            case VariableDeclaratorSyntax declarator when declarator.Parent?.Parent is FieldDeclarationSyntax or EventFieldDeclarationSyntax:
                VisitInMember(node, declarator.Identifier.Text);
                return;
            case MethodDeclarationSyntax or PropertyDeclarationSyntax or IndexerDeclarationSyntax or EventDeclarationSyntax
                or ConstructorDeclarationSyntax or DestructorDeclarationSyntax or OperatorDeclarationSyntax
                or ConversionOperatorDeclarationSyntax:
                VisitInMember(node, MemberName(node));
                return;
        }
        Process(node);
        base.Visit(node);
    }

    void VisitInMember(SyntaxNode node, string? name)
    {
        var outer = member;
        member = name;
        Process(node);
        base.Visit(node);
        member = outer;
    }

    void VisitDeclaredType(SyntaxNode node)
    {
        var symbol = model.GetDeclaredSymbol(node) as INamedTypeSymbol;
        var outerMember = member;
        member = null;
        if (symbol is not null)
        {
            RecordPart(node, symbol);
            var kind = KindOf(symbol);
            var parent = Current;
            types.Push(new TypeContext(Names.Type(symbol), kind.Root, kind.Migrations || parent is { Migrations: true }, kind.Snapshot || parent is { Snapshot: true }));
        }
        else
        {
            types.Push(Current ?? new TypeContext(null, false, false, false));
        }
        Process(node);
        base.Visit(node);
        types.Pop();
        member = outerMember;
    }

    static (bool Root, bool Migrations, bool Snapshot) KindOf(INamedTypeSymbol symbol)
    {
        return Kinds.GetOrAdd(symbol, static type =>
        {
            bool root = false, migration = false, snapshot = false;
            for (var current = type; current is not null; current = current.BaseType)
            {
                var name = Names.Type(current.OriginalDefinition);
                root |= name == DbContext;
                migration |= name == Migration;
                snapshot |= name == ModelSnapshot;
            }
            return (root, migration || snapshot, snapshot);
        });
    }

    string? FieldName(SyntaxNode node)
    {
        var declaration = node switch
        {
            FieldDeclarationSyntax field => field.Declaration,
            EventFieldDeclarationSyntax @event => @event.Declaration,
            _ => null,
        };
        return declaration?.Variables.FirstOrDefault()?.Identifier.Text;
    }

    string? MemberName(SyntaxNode node)
    {
        return node switch
        {
            MethodDeclarationSyntax method => method.Identifier.Text,
            PropertyDeclarationSyntax property => property.Identifier.Text,
            EventDeclarationSyntax @event => @event.Identifier.Text,
            _ => model.GetDeclaredSymbol(node)?.Name,
        };
    }

    int Offset(int position)
    {
        return position + bom;
    }

    void Process(SyntaxNode node)
    {
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

    void RecordPart(SyntaxNode node, INamedTypeSymbol symbol)
    {
        var keyword = node switch
        {
            TypeDeclarationSyntax type => type.Keyword,
            EnumDeclarationSyntax @enum => @enum.EnumKeyword,
            DelegateDeclarationSyntax @delegate => @delegate.DelegateKeyword,
            _ => default,
        };
        var kind = symbol.IsRecord ? "record" : symbol.TypeKind switch
        {
            TypeKind.Struct => "struct",
            TypeKind.Interface => "interface",
            TypeKind.Enum => "enum",
            TypeKind.Delegate => "delegate",
            _ => "class",
        };
        var access = symbol.IsFileLocal ? "file" : symbol.DeclaredAccessibility switch
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
        facts.Parts.Add(new TypePart(
            Names.Type(symbol),
            kind,
            Names.Namespace(symbol.ContainingNamespace),
            symbol.ContainingType is { } outer ? Names.Type(outer) : null,
            access,
            facts.Assembly,
            baseTypes,
            Offset(keyword.SpanStart),
            Offset(node.Span.End)));
    }

    void RecordUsing(UsingDirectiveSyntax directive)
    {
        var alias = directive.Alias?.Name.Identifier.Text;
        ISymbol? target = alias is null
            ? model.GetSymbolInfo(directive.NamespaceOrType).Symbol
            : (model.GetDeclaredSymbol(directive) as IAliasSymbol)?.Target;
        string text;
        string kind;
        string? type = null;
        string? assembly = null;
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
                    assembly = Names.Assembly(named.ContainingAssembly, solution, root);
                }
                break;
            default:
                // A using that binds nothing is a compiler error, and its project gives no facts.
                return;
        }
        facts.Usings.Add(new UsingFact(
            Offset(directive.SpanStart),
            directive.GlobalKeyword.RawKind != 0,
            directive.StaticKeyword.RawKind != 0,
            alias,
            text,
            kind,
            type,
            assembly));
    }
}
