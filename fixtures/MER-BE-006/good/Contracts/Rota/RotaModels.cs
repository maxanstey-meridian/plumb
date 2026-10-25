namespace Acme.Contracts.Rota;
public sealed record RotaShiftResponse(Acme.Common.ShiftWindow Window);
// Names a Conditions DTO, which names a Common type: Rota consumes RuleKind through the chain.
public sealed record RotaRuleResponse(Acme.Contracts.Conditions.ConditionResponse Condition);
