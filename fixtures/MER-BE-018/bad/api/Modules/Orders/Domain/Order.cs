namespace App.Modules.Orders.Domain;

public sealed class Order(Guid id, string reference)
{
    public global::App.Contracts.Orders.OrderDto ToDto() => new(id, reference);
}
