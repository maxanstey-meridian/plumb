using App.Contracts.Orders;
using App.Modules.Orders.Application.PlaceOrder;

namespace App.Modules.Orders;

public sealed class OrdersController(PlaceOrderUseCase placeOrder)
{
    public async Task<OrderDto> Place(CancellationToken ct)
    {
        var summary = await placeOrder.ExecuteAsync(new PlaceOrderCommand("A1"), ct);
        return new OrderDto(summary.Id, summary.Reference);
    }
}
