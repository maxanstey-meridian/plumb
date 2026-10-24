using App.Modules.Orders.Contracts;

namespace App.Modules.Orders.Application.PlaceOrder;

public sealed record PlaceOrderCommand(string Reference);

public sealed class PlaceOrderUseCase
{
    public Task<OrderSummary> ExecuteAsync(PlaceOrderCommand command, CancellationToken ct) =>
        Task.FromResult(new OrderSummary(Guid.NewGuid(), command.Reference));
}
