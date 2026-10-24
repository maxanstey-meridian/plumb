using App.Contracts.Orders;

namespace App.Modules.Orders.Application.PlaceOrder;

public sealed record PlaceOrderCommand(string Reference);

public sealed class PlaceOrderUseCase
{
    public Task<OrderDto> ExecuteAsync(PlaceOrderCommand command, CancellationToken ct) =>
        Task.FromResult(new OrderDto(Guid.NewGuid(), command.Reference));
}
