// Rota serves its own wire: RotaSlot and WireColour, which the DTO names, are still Rota's alone.
namespace Acme.Modules.Rota;
public sealed class RotaController { public Acme.Contracts.Rota.RotaSlotResponse? Slot { get; set; } }
