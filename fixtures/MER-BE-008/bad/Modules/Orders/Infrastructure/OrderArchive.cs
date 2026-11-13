using App.Modules.Orders.Domain;

namespace App.Modules.Orders.Infrastructure;

public sealed class OrderArchive : IOrderArchive
{
    public bool Holds(string order) => order.Length > 0;
}
