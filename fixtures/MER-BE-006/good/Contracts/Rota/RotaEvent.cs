// An attribute argument is part of the declaration: Rota serving RotaEvent consumes ShiftSwap.
namespace Acme.Contracts.Rota;
[System.Text.Json.Serialization.JsonDerivedType(typeof(Acme.Common.ShiftSwap))]
public abstract record RotaEvent;
