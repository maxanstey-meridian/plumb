using App.Contracts.Orders;
using App.Modules.Orders.Contracts;

namespace App.Modules.Orders.Application.PlaceOrder;

public sealed class PlaceOrderUseCase
{
    public Task<OrderSummary> ExecuteAsync(OrderDto draft, CancellationToken ct) =>
        Task.FromResult(new OrderSummary(Guid.NewGuid(), draft.Reference));
}
