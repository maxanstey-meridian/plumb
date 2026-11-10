using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Plumb.CSharpFacts;

// The table mappings: ToTable and ToView calls, [Table] attributes, a migrations snapshot's
// entities, and the default schema.
internal sealed partial class DocumentWalker
{
    private static string? CalledName(InvocationExpressionSyntax invocation)
    {
        return invocation.Expression switch
        {
            MemberAccessExpressionSyntax access => access.Name.Identifier.Text,
            SimpleNameSyntax name => name.Identifier.Text,
            _ => null,
        };
    }

    private void RecordInvocation(InvocationExpressionSyntax invocation)
    {
        var current = Current;
        if (current is null)
        {
            return;
        }
        var called = CalledName(invocation);
        if (current.Snapshot)
        {
            if (called == "Entity")
            {
                RecordSnapshotEntity(invocation);
            }
            return;
        }
        if (current.Migrations)
        {
            return;
        }
        if (called is "ToTable" or "ToView")
        {
            if (TableOf(invocation) is { } table)
            {
                _facts.Tables.Add(
                    new TableFact(
                        Offset(NameStart(invocation)),
                        table.Method,
                        table.Schema,
                        table.Table
                    )
                );
            }
        }
        else if (called == "HasDefaultSchema" && SchemaOf(invocation) is { } schema)
        {
            _facts.DefaultSchemas.Add(new DefaultSchemaFact(Offset(NameStart(invocation)), schema));
        }
    }

    private static int NameStart(InvocationExpressionSyntax invocation)
    {
        return invocation.Expression is MemberAccessExpressionSyntax access
            ? access.Name.SpanStart
            : invocation.SpanStart;
    }

    // A ToTable or ToView call on an EntityTypeBuilder, or on the OwnedNavigationBuilder of an
    // owned type that has a table of its own, whose table name is a constant: the table and its
    // schema, if any.
    private (string Method, string? Schema, string Table)? TableOf(
        InvocationExpressionSyntax invocation
    )
    {
        if (_model.GetSymbolInfo(invocation).Symbol is not IMethodSymbol bound)
        {
            return null;
        }
        var method = (bound.ReducedFrom ?? bound).OriginalDefinition;
        var declaredIn = Names.Namespace(method.ContainingNamespace);
        if (
            method.Name is not ("ToTable" or "ToView")
            || declaredIn is not ("Microsoft.EntityFrameworkCore" or EntityTypeBuilderNamespace)
        )
        {
            return null;
        }
        if (
            invocation.Expression is not MemberAccessExpressionSyntax access
            || _model.GetTypeInfo(access.Expression).Type is not INamedTypeSymbol receiver
            || receiver.OriginalDefinition
                is not {
                    Name: "EntityTypeBuilder" or "OwnedNavigationBuilder",
                    ContainingNamespace: { } receiverNamespace
                }
            || Names.Namespace(receiverNamespace) != EntityTypeBuilderNamespace
        )
        {
            return null;
        }
        string? table = null;
        string? schema = null;
        var arguments = invocation.ArgumentList.Arguments;
        for (var index = 0; index < arguments.Count; index++)
        {
            var argument = arguments[index];
            var parameter =
                argument.NameColon is { } named
                    ? bound.Parameters.FirstOrDefault(candidate =>
                        candidate.Name == named.Name.Identifier.Text
                    )
                : index < bound.Parameters.Length ? bound.Parameters[index]
                : null;
            if (parameter?.Name == "name")
            {
                table =
                    ConstantString(argument.Expression, out var isString) is { } value && isString
                        ? value
                        : null;
                if (table is null)
                {
                    return null;
                }
            }
            else if (parameter?.Name == "schema")
            {
                schema = ConstantString(argument.Expression, out var isString);
                if (!isString)
                {
                    // A schema that isn't a constant leaves the table unknown.
                    return null;
                }
            }
        }
        return table is null ? null : (method.Name, schema, table);
    }

    // The value of a compile-time constant string, or null for the null constant. `isString` is
    // false for anything else.
    private string? ConstantString(ExpressionSyntax expression, out bool isString)
    {
        var constant = _model.GetConstantValue(expression);
        if (constant.HasValue && constant.Value is string text)
        {
            isString = true;
            return text;
        }
        isString = constant.HasValue && constant.Value is null;
        return null;
    }

    private string? SchemaOf(InvocationExpressionSyntax invocation)
    {
        if (
            _model.GetSymbolInfo(invocation).Symbol is not IMethodSymbol method
            || method.OriginalDefinition.ContainingType is not { } owner
            || Names.Type(owner) != ModelBuilder
            || invocation.ArgumentList.Arguments.Count == 0
        )
        {
            return null;
        }
        var value = ConstantString(invocation.ArgumentList.Arguments[0].Expression, out _);
        return value;
    }

    // `modelBuilder.Entity("<name>", b => …)` in a snapshot: the lambda's own ToTable or ToView
    // call, and an owned type's, which the snapshot writes as
    // `b.OwnsOne("<owned name>", "<navigation>", b1 => …)` inside the owner's lambda.
    private void RecordSnapshotEntity(InvocationExpressionSyntax invocation)
    {
        var arguments = invocation.ArgumentList.Arguments;
        if (
            arguments.Count < 2
            || _model.GetSymbolInfo(invocation).Symbol is not IMethodSymbol method
            || method.OriginalDefinition.ContainingType is not { } owner
            || Names.Type(owner) != ModelBuilder
            || ConstantString(arguments[0].Expression, out var isString) is not { } entity
            || !isString
        )
        {
            return;
        }
        RecordSnapshotBuilder(entity.Replace('+', '.'), arguments[1].Expression);
    }

    // The ToTable and ToView calls on the lambda's own parameter, each as a table of `entity`, and
    // the owned types the lambda declares, each with its own.
    private void RecordSnapshotBuilder(string entity, ExpressionSyntax lambda)
    {
        var parameter = lambda switch
        {
            SimpleLambdaExpressionSyntax simple => simple.Parameter.Identifier.Text,
            ParenthesizedLambdaExpressionSyntax { ParameterList.Parameters: [var only] } =>
                only.Identifier.Text,
            _ => null,
        };
        if (parameter is null)
        {
            return;
        }
        foreach (var call in lambda.DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (
                call.Expression
                    is not MemberAccessExpressionSyntax
                    {
                        Expression: IdentifierNameSyntax receiver,
                        Name.Identifier.Text: var called
                    }
                || receiver.Identifier.Text != parameter
                || call.Ancestors().OfType<LambdaExpressionSyntax>().First() != lambda
            )
            {
                continue;
            }
            if (called is "ToTable" or "ToView")
            {
                if (TableOf(call) is { } table)
                {
                    _facts.SnapshotTables.Add(
                        new SnapshotTableFact(
                            Offset(NameStart(call)),
                            entity,
                            table.Method,
                            table.Schema,
                            table.Table
                        )
                    );
                }
            }
            else if (called is "OwnsOne" or "OwnsMany" && OwnedTypeOf(call) is { } owned)
            {
                RecordSnapshotBuilder(owned.Name, owned.Build);
            }
        }
    }

    // An OwnsOne or OwnsMany call of the snapshot's form,
    // `("<owned name>", "<navigation>", b => …)`, on an entity or owned-type builder: the owned
    // type's name and its lambda.
    private (string Name, ExpressionSyntax Build)? OwnedTypeOf(
        InvocationExpressionSyntax invocation
    )
    {
        var arguments = invocation.ArgumentList.Arguments;
        if (
            arguments.Count < 3
            || _model.GetSymbolInfo(invocation).Symbol is not IMethodSymbol bound
            || (bound.ReducedFrom ?? bound).OriginalDefinition.ContainingType
                is not {
                    Name: "EntityTypeBuilder" or "OwnedNavigationBuilder",
                    ContainingNamespace: { } declaredIn
                }
            || Names.Namespace(declaredIn) != EntityTypeBuilderNamespace
            || ConstantString(arguments[0].Expression, out var isString) is not { } name
            || !isString
        )
        {
            return null;
        }
        return (name.Replace('+', '.'), arguments[^1].Expression);
    }

    // `[Table("forms")]` on a class, with its optional `Schema = "…"`.
    private void RecordTableAttribute(AttributeSyntax attribute)
    {
        if (
            Current is not { Migrations: false }
            || attribute.Parent?.Parent is not (ClassDeclarationSyntax or RecordDeclarationSyntax)
            || attribute.ArgumentList is not { Arguments.Count: > 0 } list
            || _model.GetSymbolInfo(attribute).Symbol
                is not IMethodSymbol { MethodKind: MethodKind.Constructor } constructor
            || Names.Type(constructor.ContainingType) != TableAttribute
        )
        {
            return;
        }
        string? table = null;
        string? schema = null;
        foreach (var argument in list.Arguments)
        {
            // The table's name is the constructor's `name`: the first positional argument, or the
            // one written `name: …`.
            if (
                argument.NameEquals is null
                && (argument.NameColon is null || argument.NameColon.Name.Identifier.Text == "name")
                && table is null
            )
            {
                table =
                    ConstantString(argument.Expression, out var isString) is { } value && isString
                        ? value
                        : null;
            }
            else if (argument.NameEquals?.Name.Identifier.Text == "Schema")
            {
                schema = ConstantString(argument.Expression, out _);
            }
        }
        if (table is not null)
        {
            _facts.Tables.Add(new TableFact(Offset(attribute.SpanStart), "Table", schema, table));
        }
    }
}
