using App.Modules.Orders.Domain;

namespace App.Modules.Orders.Application;

public sealed class DefaultOrderRule : IOrderRule
{
    public bool Allows(string order) => order.Length > 0;
}
