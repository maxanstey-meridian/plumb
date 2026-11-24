using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;

namespace Plumb.CSharpFacts;

// Authorization facts: static caller-role refusal guards (for MER-BE-068 and MER-BE-069) and
// conditional RequireAuthorization calls on endpoint convention builders (for MER-BE-069).
internal sealed partial class DocumentWalker
{
    private const string EndpointConventionBuilder =
        "Microsoft.AspNetCore.Builder.IEndpointConventionBuilder";
    private const string ClaimsPrincipalType = "System.Security.Claims.ClaimsPrincipal";
    private const string PrincipalInterface = "System.Security.Principal.IPrincipal";
    private const string ClaimTypesType = "System.Security.Claims.ClaimTypes";
    private const string RoleClaimUri =
        "http://schemas.microsoft.com/ws/2008/06/identity/claims/role";

    private static readonly string[] _callerContextConventions =
    [
        "UserContext",
        "CurrentUser",
        "Caller",
        "Actor",
        "Session",
        "AuthContext",
        "RequestContext",
        "Identity",
        "Principal",
    ];

    private static readonly string[] _roleParameterNames =
    [
        "callerRole",
        "actorRole",
        "currentRole",
        "userRole",
    ];

    private static readonly string[] _refusalExceptionKeywords =
    [
        "Unauthorized",
        "Forbidden",
        "AccessDenied",
        "NotAllowed",
        "NotPermitted",
        "Permission",
    ];

    private static readonly string[] _refusalOutcomeKeywords =
    [
        "Forbidden",
        "Unauthorized",
        "AccessDenied",
        "NotAllowed",
        "NotPermitted",
        "InsufficientRole",
        "InsufficientPermission",
    ];

    private readonly record struct ConditionResult(
        bool Allowed,
        string? RoleSource,
        string? Callee
    );

    private static readonly ConditionResult _disqualified = new(false, null, null);
    private static readonly ConditionResult _allowedNoRole = new(true, null, null);

    private void RecordConditionalAuth(InvocationExpressionSyntax invocation)
    {
        if (CalledName(invocation) != "RequireAuthorization")
        {
            return;
        }
        if (
            _model.GetOperation(invocation) is not IInvocationOperation call
            || call.TargetMethod.Name != "RequireAuthorization"
        )
        {
            return;
        }
        if (!TargetsEndpointConventionBuilder(call))
        {
            return;
        }
        if (!HasEnclosingConditionalInBody(invocation))
        {
            return;
        }
        _facts.ConditionalAuths.Add(
            new ConditionalAuthFact(
                Offset(NameStart(invocation)),
                Current?.Name,
                _member,
                "RequireAuthorization"
            )
        );
    }

    private static bool TargetsEndpointConventionBuilder(IInvocationOperation call)
    {
        var target = call.TargetMethod;
        if (target.IsExtensionMethod)
        {
            if (
                call.Arguments.Length > 0
                && IsOrConstrainedTo(call.Arguments[0].Value.Type, EndpointConventionBuilder)
            )
            {
                return true;
            }
            var reduced = target.ReducedFrom ?? target;
            return reduced.Parameters.Length > 0
                && IsOrConstrainedTo(reduced.Parameters[0].Type, EndpointConventionBuilder);
        }
        return IsOrConstrainedTo(call.Instance?.Type, EndpointConventionBuilder)
            || IsOrConstrainedTo(target.ContainingType, EndpointConventionBuilder);
    }

    private static bool IsOrConstrainedTo(ITypeSymbol? type, string fullName)
    {
        if (type is ITypeParameterSymbol typeParameter)
        {
            return typeParameter.ConstraintTypes.Any(constraint =>
                IsOrDerives(constraint, fullName)
            );
        }
        return IsOrDerives(type, fullName);
    }

    private static bool HasEnclosingConditionalInBody(SyntaxNode node)
    {
        for (var current = node.Parent; current is not null; current = current.Parent)
        {
            switch (current)
            {
                case IfStatementSyntax
                or ConditionalExpressionSyntax
                or SwitchStatementSyntax
                or SwitchExpressionSyntax:
                    return true;
                case BaseMethodDeclarationSyntax
                or AccessorDeclarationSyntax
                or LocalFunctionStatementSyntax
                or AnonymousFunctionExpressionSyntax
                or BaseTypeDeclarationSyntax
                or CompilationUnitSyntax:
                    return false;
            }
        }
        return false;
    }

    private bool HasDisqualifiedEnclosingBranch(SyntaxNode node)
    {
        var previous = node;
        for (
            var current = node.Parent;
            current is not null;
            previous = current, current = current.Parent
        )
        {
            switch (current)
            {
                case IfStatementSyntax ifStatement when previous != ifStatement.Condition:
                    if (
                        !AnalyzeCondition(
                            _model.GetOperation(ifStatement.Condition),
                            new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default)
                        ).Allowed
                    )
                    {
                        return true;
                    }
                    break;
                case SwitchStatementSyntax switchStatement
                    when previous != switchStatement.Expression:
                    if (
                        !AnalyzeCondition(
                            _model.GetOperation(switchStatement.Expression),
                            new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default)
                        ).Allowed
                    )
                    {
                        return true;
                    }
                    break;
                case SwitchSectionSyntax switchSection:
                    foreach (var label in switchSection.Labels)
                    {
                        if (
                            label is CasePatternSwitchLabelSyntax { WhenClause: { } whenClause }
                            && !AnalyzeCondition(
                                _model.GetOperation(whenClause.Condition),
                                new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default)
                            ).Allowed
                        )
                        {
                            return true;
                        }
                    }
                    break;
                case BaseMethodDeclarationSyntax
                or AccessorDeclarationSyntax
                or LocalFunctionStatementSyntax
                or AnonymousFunctionExpressionSyntax
                or BaseTypeDeclarationSyntax
                or CompilationUnitSyntax:
                    return false;
            }
        }
        return false;
    }

    private void RecordRoleGuard(IfStatementSyntax ifStatement)
    {
        if (HasDisqualifiedEnclosingBranch(ifStatement))
        {
            return;
        }
        var thenRefuses = BranchExitsWithRefusal(ifStatement.Statement);
        var elseRefuses =
            !thenRefuses
            && ifStatement.Else is { Statement: not IfStatementSyntax } elseClause
            && BranchExitsWithRefusal(elseClause.Statement);
        if (!thenRefuses && !elseRefuses)
        {
            return;
        }
        var condition = AnalyzeCondition(
            _model.GetOperation(ifStatement.Condition),
            new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default)
        );
        if (condition is { Allowed: true, RoleSource: { } roleSource })
        {
            _facts.RoleGuards.Add(
                new RoleGuardFact(
                    Offset(ifStatement.SpanStart),
                    Current?.Name,
                    _member,
                    roleSource,
                    condition.Callee
                )
            );
        }
    }

    private void RecordRoleGuardReturn(ReturnStatementSyntax returnStatement)
    {
        RecordRoleGuardExpression(
            returnStatement.Expression,
            returnStatement.SpanStart,
            returnStatement
        );
    }

    private void RecordRoleGuardExpression(
        ExpressionSyntax? rawExpression,
        int start,
        SyntaxNode origin
    )
    {
        if (HasDisqualifiedEnclosingBranch(origin))
        {
            return;
        }
        var expression = UnwrapParens(rawExpression);
        if (expression is ConditionalExpressionSyntax ternary)
        {
            if (
                !IsRefusalReturnExpression(ternary.WhenTrue)
                && !IsRefusalReturnExpression(ternary.WhenFalse)
            )
            {
                return;
            }
            var condition = AnalyzeCondition(
                _model.GetOperation(ternary.Condition),
                new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default)
            );
            if (condition is { Allowed: true, RoleSource: { } roleSource })
            {
                _facts.RoleGuards.Add(
                    new RoleGuardFact(
                        Offset(start),
                        Current?.Name,
                        _member,
                        roleSource,
                        condition.Callee
                    )
                );
            }
        }
        else if (expression is SwitchExpressionSyntax switchExpression)
        {
            var visiting = new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default);
            var governing = AnalyzeCondition(
                _model.GetOperation(switchExpression.GoverningExpression),
                visiting
            );
            if (governing is not { Allowed: true, RoleSource: { } roleSource })
            {
                return;
            }
            var hasRefusalArm = false;
            foreach (var arm in switchExpression.Arms)
            {
                if (arm.WhenClause is { } whenClause)
                {
                    var whenResult = AnalyzeCondition(
                        _model.GetOperation(whenClause.Condition),
                        new HashSet<ILocalSymbol>(SymbolEqualityComparer.Default)
                    );
                    if (!whenResult.Allowed)
                    {
                        break;
                    }
                }
                if (IsRefusalReturnExpression(arm.Expression))
                {
                    hasRefusalArm = true;
                    break;
                }
            }
            if (hasRefusalArm)
            {
                _facts.RoleGuards.Add(
                    new RoleGuardFact(
                        Offset(start),
                        Current?.Name,
                        _member,
                        roleSource,
                        governing.Callee
                    )
                );
            }
        }
    }

    private static ExpressionSyntax? UnwrapParens(ExpressionSyntax? expression)
    {
        while (expression is ParenthesizedExpressionSyntax parenthesized)
        {
            expression = parenthesized.Expression;
        }
        return expression;
    }

    private bool BranchExitsWithRefusal(StatementSyntax statement)
    {
        return statement switch
        {
            ThrowStatementSyntax throwStatement => IsRefusalException(throwStatement.Expression),
            ReturnStatementSyntax returnStatement => IsRefusalReturnExpression(
                returnStatement.Expression
            ),
            BlockSyntax { Statements.Count: > 0 } block => BranchExitsWithRefusal(
                block.Statements[^1]
            ),
            _ => false,
        };
    }

    private bool IsRefusalException(ExpressionSyntax? expression)
    {
        if (expression is null)
        {
            return false;
        }
        var type = _model.GetTypeInfo(expression).Type;
        for (var current = type; current is not null; current = current.BaseType)
        {
            if (MatchesAnyKeyword(current.Name, _refusalExceptionKeywords))
            {
                return true;
            }
        }
        return false;
    }

    private bool IsRefusalReturnExpression(ExpressionSyntax? expression)
    {
        expression = UnwrapParens(expression);
        if (expression is null)
        {
            return false;
        }
        if (expression is ThrowExpressionSyntax throwExpression)
        {
            return IsRefusalException(throwExpression.Expression);
        }
        return IsRefusalOperation(_model.GetOperation(expression));
    }

    private static bool IsRefusalOperation(IOperation? operation)
    {
        operation = UnwrapOperation(operation);
        if (operation is null)
        {
            return false;
        }
        switch (operation)
        {
            case IThrowOperation throwOp:
                for (
                    var current = throwOp.Exception?.Type;
                    current is not null;
                    current = current.BaseType
                )
                {
                    if (MatchesAnyKeyword(current.Name, _refusalExceptionKeywords))
                    {
                        return true;
                    }
                }
                return false;

            case IObjectCreationOperation creation:
                if (creation.Type is { } createdType)
                {
                    if (
                        MatchesAnyKeyword(createdType.Name, _refusalOutcomeKeywords)
                        || string.Equals(
                            createdType.Name,
                            "ForbidResult",
                            StringComparison.OrdinalIgnoreCase
                        )
                    )
                    {
                        return true;
                    }
                    if (
                        string.Equals(
                            createdType.Name,
                            "StatusCodeResult",
                            StringComparison.OrdinalIgnoreCase
                        ) && HasStatusCode403(creation.Arguments)
                    )
                    {
                        return true;
                    }
                }
                return false;

            case IFieldReferenceOperation fieldRef:
                return MatchesAnyKeyword(fieldRef.Field.Name, _refusalOutcomeKeywords)
                    || (
                        fieldRef.Type is { } fieldType
                        && MatchesAnyKeyword(fieldType.Name, _refusalOutcomeKeywords)
                    );

            case IPropertyReferenceOperation propRef:
                return MatchesAnyKeyword(propRef.Property.Name, _refusalOutcomeKeywords)
                    || (
                        propRef.Type is { } propType
                        && MatchesAnyKeyword(propType.Name, _refusalOutcomeKeywords)
                    );

            case IInvocationOperation call:
                return IsRefusalInvocation(call);

            default:
                return false;
        }
    }

    private static bool IsRefusalInvocation(IInvocationOperation call)
    {
        var method = call.TargetMethod;
        if (
            method.Name == "FromResult"
            && method.ContainingType?.Name is "Task" or "ValueTask"
            && call.Arguments.Length == 1
        )
        {
            return IsRefusalOperation(call.Arguments[0].Value);
        }
        if (
            string.Equals(method.Name, "Forbid", StringComparison.OrdinalIgnoreCase)
            || MatchesAnyKeyword(method.Name, _refusalOutcomeKeywords)
        )
        {
            return true;
        }
        if (
            string.Equals(method.Name, "Fail", StringComparison.Ordinal)
            && string.Equals(method.ContainingType?.Name, "Result", StringComparison.Ordinal)
        )
        {
            return true;
        }
        if (
            (
                string.Equals(method.Name, "StatusCode", StringComparison.Ordinal)
                || string.Equals(method.Name, "Refuse", StringComparison.Ordinal)
            ) && HasStatusCode403(call.Arguments)
        )
        {
            return true;
        }
        if (call.Instance is not null && IsRefusalOperation(call.Instance))
        {
            return true;
        }
        if (
            method.IsExtensionMethod
            && call.Arguments.Length > 0
            && IsRefusalOperation(call.Arguments[0].Value)
        )
        {
            return true;
        }
        return false;
    }

    private static bool HasStatusCode403(
        System.Collections.Immutable.ImmutableArray<IArgumentOperation> arguments
    )
    {
        if (arguments.Length == 0)
        {
            return false;
        }
        foreach (var argument in arguments)
        {
            if (
                string.Equals(
                    argument.Parameter?.Name,
                    "statusCode",
                    StringComparison.OrdinalIgnoreCase
                )
            )
            {
                return argument.Value.ConstantValue is { HasValue: true, Value: 403 };
            }
        }
        return arguments[0].Value.ConstantValue is { HasValue: true, Value: 403 };
    }

    private ConditionResult AnalyzeCondition(IOperation? operation, HashSet<ILocalSymbol> visiting)
    {
        if (operation is null)
        {
            return _disqualified;
        }
        if (operation.ConstantValue.HasValue)
        {
            return _allowedNoRole;
        }
        switch (operation)
        {
            case IAwaitOperation:
                return _disqualified;

            case IConversionOperation conversion:
                return AnalyzeCondition(conversion.Operand, visiting);

            case IParenthesizedOperation parenthesized:
                return AnalyzeCondition(parenthesized.Operand, visiting);

            case IDefaultValueOperation
            or ITypeOfOperation:
                return _allowedNoRole;

            case IUnaryOperation unary:
                return AnalyzeCondition(unary.Operand, visiting);

            case IBinaryOperation binary:
                return Combine(
                    AnalyzeCondition(binary.LeftOperand, visiting),
                    AnalyzeCondition(binary.RightOperand, visiting)
                );

            case ICoalesceOperation coalesce:
                return Combine(
                    AnalyzeCondition(coalesce.Value, visiting),
                    AnalyzeCondition(coalesce.WhenNull, visiting)
                );

            case IConditionalOperation conditional:
                return Combine(
                    Combine(
                        AnalyzeCondition(conditional.Condition, visiting),
                        AnalyzeCondition(conditional.WhenTrue, visiting)
                    ),
                    AnalyzeCondition(conditional.WhenFalse, visiting)
                );

            case IIsPatternOperation isPattern:
                return AnalyzeIsPattern(isPattern, visiting);

            case IConditionalAccessOperation conditionalAccess:
                return AnalyzeConditionalAccess(conditionalAccess, visiting);

            case IConditionalAccessInstanceOperation:
                return _allowedNoRole;

            case IPropertyReferenceOperation propRef:
                return AnalyzePropertyReference(propRef, visiting);

            case IFieldReferenceOperation fieldRef:
                return AnalyzeFieldReference(fieldRef, visiting);

            case IParameterReferenceOperation paramRef:
                return AnalyzeParameterReference(paramRef);

            case ILocalReferenceOperation localRef:
                return AnalyzeLocalReference(localRef, visiting);

            case IInvocationOperation call:
                return AnalyzeInvocation(call, visiting);

            case IArrayCreationOperation arrayCreation:
                return AnalyzeArrayCreation(arrayCreation, visiting);

            case ICollectionExpressionOperation collectionExpression:
                return AnalyzeCollectionExpression(collectionExpression, visiting);

            case IObjectCreationOperation objectCreation:
                return AnalyzeObjectCreation(objectCreation, visiting);

            default:
                return _disqualified;
        }
    }

    private ConditionResult AnalyzeIsPattern(
        IIsPatternOperation isPattern,
        HashSet<ILocalSymbol> visiting
    )
    {
        var valueResult = AnalyzeCondition(isPattern.Value, visiting);
        if (!valueResult.Allowed)
        {
            return _disqualified;
        }
        var patternResult = AnalyzePattern(isPattern.Pattern, visiting);
        return Combine(valueResult, patternResult);
    }

    private ConditionResult AnalyzePattern(
        IPatternOperation pattern,
        HashSet<ILocalSymbol> visiting
    )
    {
        return pattern switch
        {
            IConstantPatternOperation constant => AnalyzeCondition(constant.Value, visiting),
            IRelationalPatternOperation relational => AnalyzeCondition(relational.Value, visiting),
            INegatedPatternOperation negated => AnalyzePattern(negated.Pattern, visiting),
            IBinaryPatternOperation binary => Combine(
                AnalyzePattern(binary.LeftPattern, visiting),
                AnalyzePattern(binary.RightPattern, visiting)
            ),
            IDiscardPatternOperation or ITypePatternOperation or IDeclarationPatternOperation =>
                _allowedNoRole,
            _ => _disqualified,
        };
    }

    private ConditionResult AnalyzeConditionalAccess(
        IConditionalAccessOperation access,
        HashSet<ILocalSymbol> visiting
    )
    {
        var receiver = AnalyzeCondition(access.Operation, visiting);
        if (!receiver.Allowed)
        {
            return _disqualified;
        }
        var whenNotNull = UnwrapOperation(access.WhenNotNull);
        if (
            whenNotNull is IPropertyReferenceOperation { Property.Name: "Value" or "HasValue" }
            && receiver.RoleSource is not null
        )
        {
            return receiver;
        }
        if (whenNotNull is IInvocationOperation innerCall)
        {
            if (IsAsyncReturnType(innerCall.Type))
            {
                return _disqualified;
            }
            var argsResult = AnalyzeArguments(innerCall.Arguments, visiting);
            if (!argsResult.Allowed)
            {
                return _disqualified;
            }
            var combined = Combine(receiver, argsResult);
            if (
                combined.RoleSource is not null
                && innerCall.TargetMethod.ReturnType.SpecialType == SpecialType.System_Boolean
            )
            {
                return combined with { Callee = FormatCallee(innerCall.TargetMethod) };
            }
            return combined;
        }
        return _disqualified;
    }

    private ConditionResult AnalyzePropertyReference(
        IPropertyReferenceOperation propRef,
        HashSet<ILocalSymbol> visiting
    )
    {
        if (propRef.Property.Name is "Role" or "Roles" && propRef.Instance is not null)
        {
            if (TryResolveCallerRoleReceiver(propRef.Instance, visiting, out var receiverType))
            {
                return new ConditionResult(
                    true,
                    $"{SimpleTypeName(receiverType)}.{propRef.Property.Name}",
                    null
                );
            }
            return _disqualified;
        }
        if (propRef.Property.IsStatic && propRef.Property.SetMethod is null)
        {
            return _allowedNoRole;
        }
        if (propRef.Property.Name is "Value" or "HasValue" && propRef.Instance is not null)
        {
            var inner = AnalyzeCondition(propRef.Instance, visiting);
            if (inner is { Allowed: true, RoleSource: not null })
            {
                return inner;
            }
        }
        return _disqualified;
    }

    private ConditionResult AnalyzeFieldReference(
        IFieldReferenceOperation fieldRef,
        HashSet<ILocalSymbol> visiting
    )
    {
        if (fieldRef.Field.Name is "Role" or "Roles" && fieldRef.Instance is not null)
        {
            if (TryResolveCallerRoleReceiver(fieldRef.Instance, visiting, out var receiverType))
            {
                return new ConditionResult(
                    true,
                    $"{SimpleTypeName(receiverType)}.{fieldRef.Field.Name}",
                    null
                );
            }
            return _disqualified;
        }
        if (fieldRef.Field.IsStatic && fieldRef.Field.IsReadOnly)
        {
            return _allowedNoRole;
        }
        return _disqualified;
    }

    private static ConditionResult AnalyzeParameterReference(IParameterReferenceOperation paramRef)
    {
        if (IsRoleParameter(paramRef.Parameter))
        {
            return new ConditionResult(true, paramRef.Parameter.Name, null);
        }
        return _disqualified;
    }

    private ConditionResult AnalyzeLocalReference(
        ILocalReferenceOperation localRef,
        HashSet<ILocalSymbol> visiting
    )
    {
        var local = localRef.Local;
        if (!visiting.Add(local))
        {
            return _disqualified;
        }
        try
        {
            foreach (var declaration in local.DeclaringSyntaxReferences)
            {
                if (declaration.SyntaxTree != _model.SyntaxTree)
                {
                    continue;
                }
                if (
                    declaration.GetSyntax()
                        is VariableDeclaratorSyntax { Initializer.Value: { } initExpr } declarator
                    && !IsLocalReassigned(declarator, local)
                )
                {
                    return AnalyzeCondition(_model.GetOperation(initExpr), visiting);
                }
            }
            return _disqualified;
        }
        finally
        {
            visiting.Remove(local);
        }
    }

    private bool IsLocalReassigned(VariableDeclaratorSyntax declarator, ILocalSymbol local)
    {
        var scope = declarator
            .Ancestors()
            .FirstOrDefault(ancestor =>
                ancestor
                    is BaseMethodDeclarationSyntax
                        or AccessorDeclarationSyntax
                        or LocalFunctionStatementSyntax
                        or AnonymousFunctionExpressionSyntax
                        or CompilationUnitSyntax
            );
        if (scope is null)
        {
            return false;
        }
        foreach (var assignment in scope.DescendantNodes().OfType<AssignmentExpressionSyntax>())
        {
            if (
                SymbolEqualityComparer.Default.Equals(
                    _model.GetSymbolInfo(assignment.Left).Symbol,
                    local
                )
            )
            {
                return true;
            }
        }
        return false;
    }

    private ConditionResult AnalyzeInvocation(
        IInvocationOperation call,
        HashSet<ILocalSymbol> visiting
    )
    {
        if (IsAsyncReturnType(call.Type))
        {
            return _disqualified;
        }
        var method = call.TargetMethod;

        // 1. ClaimsPrincipal.IsInRole / IPrincipal.IsInRole
        if (
            method.Name == "IsInRole"
            && (
                IsOrDerives(method.ContainingType, ClaimsPrincipalType)
                || IsOrDerives(method.ContainingType, PrincipalInterface)
            )
        )
        {
            var argsResult = AnalyzeArguments(call.Arguments, visiting);
            if (!argsResult.Allowed)
            {
                return _disqualified;
            }
            var source = IsOrDerives(method.ContainingType, ClaimsPrincipalType)
                ? "ClaimsPrincipal.IsInRole"
                : "IPrincipal.IsInRole";
            return new ConditionResult(true, source, source);
        }

        // 2. ClaimsPrincipal claim reads referencing ClaimTypes.Role
        if (TryAnalyzeClaimRoleRead(call, visiting, out var claimResult))
        {
            return claimResult;
        }

        // 3. Synchronous pure / injected predicate or helper calls
        ConditionResult receiverResult;
        if (method.IsStatic)
        {
            receiverResult = _allowedNoRole;
        }
        else if (call.Instance is IInstanceReferenceOperation)
        {
            receiverResult = _allowedNoRole;
        }
        else if (call.Instance is not null && IsInjectedReceiver(call.Instance))
        {
            receiverResult = _allowedNoRole;
        }
        else if (call.Instance is not null)
        {
            receiverResult = AnalyzeCondition(call.Instance, visiting);
            if (!receiverResult.Allowed)
            {
                return _disqualified;
            }
        }
        else
        {
            return _disqualified;
        }

        var argumentsResult = AnalyzeArguments(call.Arguments, visiting);
        if (!argumentsResult.Allowed)
        {
            return _disqualified;
        }

        var combined = Combine(receiverResult, argumentsResult);
        if (
            combined.RoleSource is not null
            && method.ReturnType.SpecialType == SpecialType.System_Boolean
        )
        {
            return combined with { Callee = FormatCallee(method) };
        }
        return combined;
    }

    private bool TryAnalyzeClaimRoleRead(
        IInvocationOperation call,
        HashSet<ILocalSymbol> visiting,
        out ConditionResult result
    )
    {
        result = _disqualified;
        var method = call.TargetMethod;
        ITypeSymbol? receiverType = method.IsExtensionMethod
            ? (call.Arguments.Length > 0 ? call.Arguments[0].Value.Type : null)
            : call.Instance?.Type;
        if (!IsOrDerives(receiverType, ClaimsPrincipalType))
        {
            return false;
        }

        var startIndex = method.IsExtensionMethod ? 1 : 0;
        var hasRoleClaimArg = false;
        for (var index = startIndex; index < call.Arguments.Length; index++)
        {
            var argValue = call.Arguments[index].Value;
            if (IsRoleClaimTypeArgument(argValue))
            {
                hasRoleClaimArg = true;
                continue;
            }
            var argResult = AnalyzeCondition(argValue, visiting);
            if (!argResult.Allowed)
            {
                return false;
            }
        }
        if (!hasRoleClaimArg)
        {
            return false;
        }
        var callee =
            method.ReturnType.SpecialType == SpecialType.System_Boolean
                ? FormatCallee(method)
                : null;
        result = new ConditionResult(true, "ClaimTypes.Role", callee);
        return true;
    }

    private static bool IsRoleClaimTypeArgument(IOperation operation)
    {
        operation = UnwrapOperation(operation)!;
        if (
            operation is IFieldReferenceOperation fieldRef
            && fieldRef.Field.Name == "Role"
            && IsOrDerives(fieldRef.Field.ContainingType, ClaimTypesType)
        )
        {
            return true;
        }
        return operation.ConstantValue is { HasValue: true, Value: RoleClaimUri };
    }

    private ConditionResult AnalyzeArguments(
        System.Collections.Immutable.ImmutableArray<IArgumentOperation> arguments,
        HashSet<ILocalSymbol> visiting
    )
    {
        var combined = _allowedNoRole;
        foreach (var argument in arguments)
        {
            var argResult = AnalyzeCondition(argument.Value, visiting);
            if (!argResult.Allowed)
            {
                return _disqualified;
            }
            combined = Combine(combined, argResult);
        }
        return combined;
    }

    private ConditionResult AnalyzeArrayCreation(
        IArrayCreationOperation arrayCreation,
        HashSet<ILocalSymbol> visiting
    )
    {
        var combined = _allowedNoRole;
        if (arrayCreation.Initializer is not null)
        {
            foreach (var element in arrayCreation.Initializer.ElementValues)
            {
                var elementResult = AnalyzeCondition(element, visiting);
                if (!elementResult.Allowed)
                {
                    return _disqualified;
                }
                combined = Combine(combined, elementResult);
            }
        }
        return combined;
    }

    private ConditionResult AnalyzeCollectionExpression(
        ICollectionExpressionOperation collection,
        HashSet<ILocalSymbol> visiting
    )
    {
        var combined = _allowedNoRole;
        foreach (var element in collection.Elements)
        {
            var elementResult = AnalyzeCondition(element, visiting);
            if (!elementResult.Allowed)
            {
                return _disqualified;
            }
            combined = Combine(combined, elementResult);
        }
        return combined;
    }

    private ConditionResult AnalyzeObjectCreation(
        IObjectCreationOperation creation,
        HashSet<ILocalSymbol> visiting
    )
    {
        if (creation.Type is null || !IsCollectionType(creation.Type))
        {
            return _disqualified;
        }
        var combined = AnalyzeArguments(creation.Arguments, visiting);
        if (!combined.Allowed)
        {
            return _disqualified;
        }
        if (creation.Initializer is not null)
        {
            foreach (var init in creation.Initializer.Initializers)
            {
                if (init is IInvocationOperation addCall)
                {
                    var addArgs = AnalyzeArguments(addCall.Arguments, visiting);
                    if (!addArgs.Allowed)
                    {
                        return _disqualified;
                    }
                    combined = Combine(combined, addArgs);
                }
                else
                {
                    var initResult = AnalyzeCondition(init, visiting);
                    if (!initResult.Allowed)
                    {
                        return _disqualified;
                    }
                    combined = Combine(combined, initResult);
                }
            }
        }
        return combined;
    }

    private static bool IsCollectionType(ITypeSymbol type)
    {
        if (type is INamedTypeSymbol named)
        {
            var ns = Names.Namespace(named.ContainingNamespace);
            if (ns is "System.Collections.Generic" or "System.Collections.Immutable")
            {
                return true;
            }
        }
        return false;
    }

    private bool TryResolveCallerRoleReceiver(
        IOperation receiver,
        HashSet<ILocalSymbol> visiting,
        out ITypeSymbol receiverType
    )
    {
        receiver = UnwrapOperation(receiver)!;
        receiverType = receiver.Type!;
        if (receiverType is null)
        {
            return false;
        }
        if (IsInjectedReceiver(receiver))
        {
            return true;
        }
        if (
            receiver is IParameterReferenceOperation or IPropertyReferenceOperation
            && MatchesCallerContextType(receiverType)
        )
        {
            return true;
        }
        if (receiver is ILocalReferenceOperation localRef && visiting.Add(localRef.Local))
        {
            try
            {
                foreach (var declaration in localRef.Local.DeclaringSyntaxReferences)
                {
                    if (declaration.SyntaxTree != _model.SyntaxTree)
                    {
                        continue;
                    }
                    if (
                        declaration.GetSyntax()
                            is VariableDeclaratorSyntax { Initializer.Value: { } initExpr } decl
                        && !IsLocalReassigned(decl, localRef.Local)
                        && _model.GetOperation(initExpr) is { } initOp
                    )
                    {
                        return TryResolveCallerRoleReceiver(initOp, visiting, out receiverType);
                    }
                }
            }
            finally
            {
                visiting.Remove(localRef.Local);
            }
        }
        return false;
    }

    private static bool IsInjectedReceiver(IOperation receiver)
    {
        receiver = UnwrapOperation(receiver)!;
        return receiver switch
        {
            IFieldReferenceOperation
            {
                Field.IsStatic: false,
                Instance: IInstanceReferenceOperation
            } => true,
            IParameterReferenceOperation
            {
                Parameter.ContainingSymbol: IMethodSymbol { MethodKind: MethodKind.Constructor }
            } => true,
            _ => false,
        };
    }

    private static bool MatchesCallerContextType(ITypeSymbol? type)
    {
        if (type is null)
        {
            return false;
        }
        return MatchesAnyKeyword(type.Name, _callerContextConventions);
    }

    private static bool IsRoleParameter(IParameterSymbol parameter)
    {
        var matchesName = _roleParameterNames.Any(name =>
            string.Equals(parameter.Name, name, StringComparison.OrdinalIgnoreCase)
        );
        if (!matchesName)
        {
            return false;
        }
        var type = parameter.Type;
        if (type.SpecialType == SpecialType.System_String)
        {
            return true;
        }
        if (type.TypeKind == TypeKind.Enum)
        {
            return true;
        }
        if (
            type is INamedTypeSymbol
            {
                OriginalDefinition.SpecialType: SpecialType.System_Nullable_T,
                TypeArguments: [{ TypeKind: TypeKind.Enum }]
            }
        )
        {
            return true;
        }
        return false;
    }

    private static bool IsAsyncReturnType(ITypeSymbol? type)
    {
        if (type is not INamedTypeSymbol named)
        {
            return false;
        }
        var ns = Names.Namespace(named.ContainingNamespace);
        return ns == "System.Threading.Tasks" && named.Name is "Task" or "ValueTask";
    }

    private static bool MatchesAnyKeyword(string name, string[] keywords)
    {
        foreach (var keyword in keywords)
        {
            if (name.Contains(keyword, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }
        return false;
    }

    private static string SimpleTypeName(ITypeSymbol type)
    {
        return type.Name;
    }

    private static string FormatCallee(IMethodSymbol method)
    {
        return $"{SimpleTypeName(method.ContainingType)}.{method.Name}";
    }

    private static IOperation? UnwrapOperation(IOperation? operation)
    {
        while (true)
        {
            switch (operation)
            {
                case IConversionOperation conversion:
                    operation = conversion.Operand;
                    continue;
                case IParenthesizedOperation parenthesized:
                    operation = parenthesized.Operand;
                    continue;
            }
            return operation;
        }
    }

    private static ConditionResult Combine(ConditionResult left, ConditionResult right)
    {
        if (!left.Allowed || !right.Allowed)
        {
            return _disqualified;
        }
        return new ConditionResult(
            true,
            left.RoleSource ?? right.RoleSource,
            left.Callee ?? right.Callee
        );
    }
}
