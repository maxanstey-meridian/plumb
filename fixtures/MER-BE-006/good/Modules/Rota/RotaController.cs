// Rota references only the contract class; the DTOs it names, and the Common types those name, are Rota's too.
namespace Acme.Modules.Rota;
public sealed class RotaController { public string Route => Acme.Contracts.Rota.RotaContract.ListRoute; }
