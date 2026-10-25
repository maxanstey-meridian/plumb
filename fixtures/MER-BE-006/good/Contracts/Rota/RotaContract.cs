namespace Acme.Contracts.Rota;
// Stands in for a Rivet contract class whose Define<…> fields name its DTOs.
public static class RotaContract
{
    public const string ListRoute = "/api/rota";
    public static RotaShiftResponse? Shift;
    public static RotaRuleResponse? Rule;
}
