using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Plumb.CSharpFacts;

// The uses: what each simple name binds to, and the type of each expression.
sealed partial class DocumentWalker
{
    // A simple name that binds to a type, a member, or an attribute's constructor is a use of that type.
    void RecordName(SimpleNameSyntax name)
    {
        if (name.IsVar)
        {
            // `var` is a use of the inferred type, with no name written.
            RecordDeep(model.GetTypeInfo(name).Type, name.Identifier.Span, Written.None);
            return;
        }
        var info = model.GetSymbolInfo(name);
        var symbol = info.Symbol ?? (info.CandidateSymbols.Length == 1 ? info.CandidateSymbols[0] : null);
        // An alias stands for the whole type it names, so a use of it is a use of the types inside that type too, judged as
        // written at the alias (`Written` is the alias's, which the rules that skip imported names already read).
        if (symbol is ITypeSymbol aliased && model.GetAliasInfo(name) is not null)
        {
            if (IsPlainNamed(aliased))
            {
                var outer = (INamedTypeSymbol)aliased;
                Add(outer.OriginalDefinition, name.Identifier.Span, null, WrittenOf(name), QualifiesAType(name));
                foreach (var argument in ArgumentsOf(outer))
                {
                    RecordDeep(argument, name.Identifier.Span, WrittenOf(name));
                }
            }
            else
            {
                RecordDeep(aliased, name.Identifier.Span, WrittenOf(name));
            }
            return;
        }
        INamedTypeSymbol? to;
        string? used = null;
        switch (symbol)
        {
            case INamedTypeSymbol type:
                to = type.OriginalDefinition;
                break;
            case IMethodSymbol { MethodKind: MethodKind.Constructor } constructor:
                to = constructor.ContainingType.OriginalDefinition;
                break;
            case IMethodSymbol or IPropertySymbol or IFieldSymbol or IEventSymbol:
                var original = Original(symbol);
                to = Static(original.ContainingType);
                used = original.Name;
                break;
            default:
                return;
        }
        if (to is null)
        {
            return;
        }
        Add(to, name.Identifier.Span, used, WrittenOf(name), used is null && QualifiesAType(name));
    }

    // The member a use binds to, past every override: the compiler dispatches through the original (Decision 10).
    static ISymbol Original(ISymbol symbol)
    {
        while (true)
        {
            symbol = symbol is IMethodSymbol { ReducedFrom: { } reduced } ? reduced : symbol;
            symbol = symbol.OriginalDefinition;
            var overridden = symbol switch
            {
                IMethodSymbol { IsOverride: true } method => method.OverriddenMethod as ISymbol,
                IPropertySymbol { IsOverride: true } property => property.OverriddenProperty,
                IEventSymbol { IsOverride: true } @event => @event.OverriddenEvent,
                _ => null,
            };
            if (overridden is null)
            {
                return symbol;
            }
            symbol = overridden;
        }
    }

    // A member of a C# 14 extension block belongs to the static class that holds the block.
    static INamedTypeSymbol? Static(INamedTypeSymbol? type)
    {
        while (type is { IsExtension: true })
        {
            type = type.ContainingType;
        }
        return type?.OriginalDefinition;
    }

    // Every expression's type and converted type: `var x = port.Get()`, `db.Forms`, `new()`, and lambdas.
    void RecordExpression(ExpressionSyntax expression)
    {
        if (expression is TypeSyntax and not (SimpleNameSyntax or QualifiedNameSyntax or AliasQualifiedNameSyntax))
        {
            return;
        }
        if (expression is SimpleNameSyntax or QualifiedNameSyntax or AliasQualifiedNameSyntax or MemberAccessExpressionSyntax)
        {
            // An attribute's name is no value: it binds to a constructor, and its class is recorded by the name pass.
            if (expression.FirstAncestorOrSelf<AttributeSyntax>() is { } attribute && attribute.Name.Span.Contains(expression.Span))
            {
                return;
            }
            // A name that names a type or a namespace has no value of its own.
            if (model.GetSymbolInfo(expression).Symbol is ITypeSymbol or INamespaceSymbol)
            {
                return;
            }
        }
        var info = model.GetTypeInfo(expression);
        RecordDeep(info.Type, expression.Span, Written.None);
        if (!SymbolEqualityComparer.Default.Equals(info.Type, info.ConvertedType))
        {
            RecordDeep(info.ConvertedType, expression.Span, Written.None);
        }
    }

    // A type, with the array elements, nullable underlying types, tuple elements, and type arguments inside it, each a
    // use of its own.
    void RecordDeep(ITypeSymbol? type, Microsoft.CodeAnalysis.Text.TextSpan span, Written written)
    {
        foreach (var named in NamedTypesIn(type))
        {
            Add(named.OriginalDefinition, span, null, written, false);
        }
    }

    // Each named type in a type, outermost first: the array elements, pointer targets, tuple elements, nullable underlying
    // types, and type arguments inside it. An error type, an anonymous type, a tuple, and a `Nullable<T>` yield themselves nothing.
    static IEnumerable<INamedTypeSymbol> NamedTypesIn(ITypeSymbol? type)
    {
        switch (type)
        {
            case null:
                yield break;
            case IArrayTypeSymbol array:
                foreach (var inner in NamedTypesIn(array.ElementType))
                {
                    yield return inner;
                }
                yield break;
            case IPointerTypeSymbol pointer:
                foreach (var inner in NamedTypesIn(pointer.PointedAtType))
                {
                    yield return inner;
                }
                yield break;
            case INamedTypeSymbol { TypeKind: TypeKind.Error }:
                yield break;
            case INamedTypeSymbol { IsTupleType: true } tuple:
                foreach (var element in tuple.TupleElements)
                {
                    foreach (var inner in NamedTypesIn(element.Type))
                    {
                        yield return inner;
                    }
                }
                yield break;
            case INamedTypeSymbol { OriginalDefinition.SpecialType: SpecialType.System_Nullable_T } nullable:
                foreach (var inner in NamedTypesIn(nullable.TypeArguments[0]))
                {
                    yield return inner;
                }
                yield break;
            case INamedTypeSymbol { IsAnonymousType: true }:
                yield break;
            case INamedTypeSymbol named:
                yield return named;
                foreach (var inner in ArgumentsOf(named).SelectMany(NamedTypesIn))
                {
                    yield return inner;
                }
                yield break;
        }
    }

    // The type arguments a named type holds: its own and those of every type it is nested in
    // (`List<Thing>.Enumerator` holds Thing on its container, not on itself).
    static IEnumerable<ITypeSymbol> ArgumentsOf(INamedTypeSymbol type)
    {
        for (var t = type; t is not null; t = t.ContainingType)
        {
            foreach (var argument in t.TypeArguments)
            {
                yield return argument;
            }
        }
    }

    // A named type that is neither a tuple nor `Nullable<T>`: the one type an alias or `using static` names, whose own
    // type arguments are the types inside it.
    static bool IsPlainNamed(ITypeSymbol type)
    {
        return type is INamedTypeSymbol { IsTupleType: false, OriginalDefinition.SpecialType: not SpecialType.System_Nullable_T };
    }

    void Add(INamedTypeSymbol to, Microsoft.CodeAnalysis.Text.TextSpan span, string? used, Written written, bool qualifier)
    {
        var origin = filter.OriginOf(to);
        var current = Current;
        if (origin == TypeOrigin.Ignored || (origin == TypeOrigin.WantedOutside && current is { Migrations: true }))
        {
            return;
        }
        var name = Names.Type(to);
        // A use of a type inside its own declaration isn't listed, except one root member calling another.
        if (current is { Name: { } own } && own == name && !(current.PersistenceRoot && used is not null))
        {
            return;
        }
        var fact = new ReferenceFact(
            Offset(span.Start),
            Offset(span.End),
            current?.Name,
            member,
            name,
            Names.Assembly(to.ContainingAssembly, solution, root),
            used,
            written,
            qualifier,
            origin == TypeOrigin.WantedOutside,
            Names.Namespace(to.ContainingNamespace));
        if (seen.Add(fact))
        {
            facts.References.Add(fact);
        }
    }

    // `Outer` in `Outer.Inner`: a type name that qualifies another type's name.
    bool QualifiesAType(SimpleNameSyntax name)
    {
        // The dotted name that ends with this name (`Forms.Contracts.Outer` for `Outer`) is what the next name qualifies.
        SyntaxNode ending = name;
        switch (name.Parent)
        {
            case QualifiedNameSyntax qualified when qualified.Right == name:
                ending = qualified;
                break;
            case MemberAccessExpressionSyntax access when access.Name == name && access.IsKind(SyntaxKind.SimpleMemberAccessExpression):
                ending = access;
                break;
        }
        return ending.Parent switch
        {
            QualifiedNameSyntax qualified when qualified.Left == ending => model.GetSymbolInfo(qualified.Right).Symbol is INamedTypeSymbol,
            MemberAccessExpressionSyntax access when access.Expression == ending => model.GetSymbolInfo(access.Name).Symbol is INamedTypeSymbol,
            _ => false,
        };
    }

    // How the type's name appears there, judged by the leftmost name of the dotted name this name is part of.
    Written WrittenOf(SimpleNameSyntax name)
    {
        SyntaxNode top = name;
        while (true)
        {
            var parent = top.Parent;
            if (parent is QualifiedNameSyntax qualified && (qualified.Left == top || qualified.Right == top))
            {
                top = qualified;
            }
            else if (parent is MemberAccessExpressionSyntax access && access.IsKind(SyntaxKind.SimpleMemberAccessExpression) && (access.Expression == top || access.Name == top))
            {
                top = access;
            }
            else if (parent is AliasQualifiedNameSyntax alias && alias.Name == top)
            {
                top = alias;
            }
            else
            {
                break;
            }
        }
        var leftmost = top;
        while (true)
        {
            switch (leftmost)
            {
                case QualifiedNameSyntax qualified:
                    leftmost = qualified.Left;
                    continue;
                case MemberAccessExpressionSyntax access:
                    leftmost = access.Expression;
                    continue;
                case AliasQualifiedNameSyntax:
                    return Written.Qualified;
            }
            break;
        }
        if (leftmost is not SimpleNameSyntax first)
        {
            return Written.None;
        }
        var bound = model.GetSymbolInfo(first).Symbol;
        // An attribute's name binds to its constructor; the name is written for the class.
        bound = bound is IMethodSymbol { MethodKind: MethodKind.Constructor } constructor ? constructor.ContainingType : bound;
        // An alias is imported whatever type it names: an array or a pointer binds to no named type.
        if (bound is ITypeSymbol && model.GetAliasInfo(first) is not null)
        {
            return Written.Imported;
        }
        switch (bound)
        {
            case INamespaceSymbol:
                return Written.Qualified;
            case INamedTypeSymbol type:
                return FoundWithoutUsing(first, type.OriginalDefinition) ? Written.Enclosing : Written.Imported;
            default:
                return Written.None;
        }
    }

    // Whether a type is in scope where `place` is through its enclosing namespaces or enclosing types alone.
    bool FoundWithoutUsing(SyntaxNode place, INamedTypeSymbol type)
    {
        if (type.ContainingType is { } outer)
        {
            for (var node = place.Parent; node is not null; node = node.Parent)
            {
                if (node is BaseTypeDeclarationSyntax && model.GetDeclaredSymbol(node) is INamedTypeSymbol enclosing)
                {
                    for (var current = enclosing; current is not null; current = current.BaseType)
                    {
                        if (SymbolEqualityComparer.Default.Equals(current.OriginalDefinition, outer.OriginalDefinition))
                        {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
        var around = model.GetEnclosingSymbol(place.SpanStart);
        for (var scope = around as INamespaceSymbol ?? around?.ContainingNamespace; scope is not null; scope = scope.ContainingNamespace)
        {
            if (SymbolEqualityComparer.Default.Equals(scope, type.ContainingNamespace))
            {
                return true;
            }
        }
        return type.ContainingNamespace.IsGlobalNamespace;
    }
}
