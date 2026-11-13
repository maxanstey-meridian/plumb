using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;

namespace Plumb.CSharpFacts;

// The code the framework calls for a request without a class of its own to say so: a handler given
// to an endpoint route (`app.MapGet("/x", handler)`), a handler put on an authentication events
// property (`options.Events.OnTokenValidated = handler`), and a class whose method takes an
// authentication event's context, which such a handler forwards to.
internal sealed partial class DocumentWalker
{
    private const string Endpoint = "endpoint";
    private const string SignIn = "sign-in";
    private const string EndpointRouteBuilder =
        "Microsoft.AspNetCore.Routing.IEndpointRouteBuilder";
    private const string AuthenticationContext = "Microsoft.AspNetCore.Authentication.BaseContext`1";

    // The events classes whose delegate properties are the handlers of a sign-in. OpenID Connect's
    // and OAuth's derive from the remote one.
    private static readonly string[] _eventsBases =
    [
        "Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationEvents",
        "Microsoft.AspNetCore.Authentication.RemoteAuthenticationEvents",
        "Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents",
    ];

    private static bool IsOrDerives(ITypeSymbol? type, string name)
    {
        if (type is not INamedTypeSymbol named)
        {
            return false;
        }
        for (var current = named; current is not null; current = current.BaseType)
        {
            if (Names.Type(current.OriginalDefinition) == name)
            {
                return true;
            }
        }
        return named.AllInterfaces.Any(@interface =>
            Names.Type(@interface.OriginalDefinition) == name
        );
    }

    private static bool IsDelegate(ITypeSymbol type)
    {
        return type.TypeKind == TypeKind.Delegate
            || type.SpecialType is SpecialType.System_Delegate or SpecialType.System_MulticastDelegate;
    }

    // `app.MapGet("/x", handler)`: each delegate argument of an extension method on
    // IEndpointRouteBuilder, by the parameter's declared type (a WebApplication is a route builder
    // and an application builder, and `app.Use(…)` extends the second).
    private void RecordEndpointHandlers(InvocationExpressionSyntax invocation)
    {
        if (
            _model.GetOperation(invocation) is not IInvocationOperation call
            || !call.TargetMethod.IsExtensionMethod
        )
        {
            return;
        }
        var method = call.TargetMethod.ReducedFrom ?? call.TargetMethod;
        if (
            method.Parameters.Length == 0
            || !IsOrDerives(method.Parameters[0].Type, EndpointRouteBuilder)
        )
        {
            return;
        }
        foreach (var argument in call.Arguments)
        {
            if (argument.Parameter is { } parameter && IsDelegate(parameter.Type))
            {
                RecordHandler(argument.Value, Endpoint);
            }
        }
    }

    // `options.Events.OnTokenValidated = handler`, `+= handler`, and the same in an object
    // initializer: a delegate property declared on an authentication events class.
    private void RecordEventsHandler(AssignmentExpressionSyntax assignment)
    {
        var (target, value) = _model.GetOperation(assignment) switch
        {
            ISimpleAssignmentOperation simple => (simple.Target, simple.Value),
            ICompoundAssignmentOperation compound => (compound.Target, compound.Value),
            _ => (null, null),
        };
        if (
            target is IPropertyReferenceOperation { Property: var property }
            && IsDelegate(property.Type)
            && _eventsBases.Any(events => IsOrDerives(property.ContainingType, events))
        )
        {
            RecordHandler(value, SignIn);
        }
    }

    // A lambda or anonymous method is a handler by its span, and so is a local function, which is
    // declared in this document. A method of a type is one by the type's name and its own.
    private void RecordHandler(IOperation? value, string kind)
    {
        while (true)
        {
            switch (value)
            {
                case IConversionOperation conversion:
                    value = conversion.Operand;
                    continue;
                case IParenthesizedOperation parenthesized:
                    value = parenthesized.Operand;
                    continue;
                case IDelegateCreationOperation creation:
                    value = creation.Target;
                    continue;
            }
            break;
        }
        switch (value)
        {
            case IAnonymousFunctionOperation function:
                _facts.Handlers.Add(
                    new HandlerFact(
                        Offset(function.Syntax.SpanStart),
                        Offset(function.Syntax.Span.End),
                        kind
                    )
                );
                break;
            case IMethodReferenceOperation { Method.MethodKind: MethodKind.LocalFunction } local:
                foreach (var declaration in local.Method.DeclaringSyntaxReferences)
                {
                    if (declaration.SyntaxTree == _model.SyntaxTree)
                    {
                        _facts.Handlers.Add(
                            new HandlerFact(
                                Offset(declaration.Span.Start),
                                Offset(declaration.Span.End),
                                kind
                            )
                        );
                    }
                }
                break;
            case IMethodReferenceOperation { Method.ContainingType: { } owner } reference:
                _facts.HandlerMembers.Add(
                    new HandlerMemberFact(
                        Names.Type(owner.OriginalDefinition),
                        reference.Method.Name,
                        kind
                    )
                );
                break;
        }
    }

    // A type with a method that takes an authentication event's context (a RedirectContext, a
    // CookieValidatePrincipalContext) handles sign-in requests, whatever it derives from.
    private void RecordHandlerType(MethodDeclarationSyntax method)
    {
        if (
            !_declarationsOnly
            && Current is { Name: { } type }
            && _model.GetDeclaredSymbol(method) is IMethodSymbol symbol
            && symbol.Parameters.Any(parameter =>
                IsOrDerives(parameter.Type, AuthenticationContext)
            )
        )
        {
            _facts.HandlerTypes.Add(type);
        }
    }
}
