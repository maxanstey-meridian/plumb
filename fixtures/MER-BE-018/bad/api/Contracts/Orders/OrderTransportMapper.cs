using App.Modules.Orders.Contracts;

namespace App.Contracts.Orders;

public static class OrderTransportMapper
{
    public static OrderDto ToDto(OrderSummary summary) => new(summary.Id, summary.Reference);
}
