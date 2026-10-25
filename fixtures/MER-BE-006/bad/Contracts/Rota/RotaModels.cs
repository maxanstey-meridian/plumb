namespace Acme.Contracts.Rota;
public sealed record RotaSlotResponse(Acme.Common.RotaSlot Slot, Acme.Common.WireColour Colour);
// Only a test references this DTO, so it adds no consumer to RetryBudget.
public sealed record RotaRetryResponse(Acme.Common.RetryBudget Budget);
