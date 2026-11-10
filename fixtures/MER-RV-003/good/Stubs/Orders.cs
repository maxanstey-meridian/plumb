namespace App;

public sealed record CreateOrderRequest(string Name);

public sealed record CreateOrderResponse(Guid Id);

public sealed record ListOrdersResponse(IReadOnlyList<string> Orders);

public sealed record CancelOrderRequest(Guid OrderId);

public sealed record OrderDraftResponse;

public sealed record SaveOrderDraftRequest;

public sealed record CreateOrderCommand(string Name);

public sealed record CancelOrderCommand(Guid OrderId);

public sealed record CreatedOrder(Guid Id);

public sealed class CreateOrderUseCase
{
    public Task<CreatedOrder> ExecuteAsync(CreateOrderCommand command, CancellationToken ct) => Task.FromResult(new CreatedOrder(Guid.NewGuid()));
}

public sealed class ListOrdersUseCase
{
    public Task<IReadOnlyList<string>> ExecuteAsync(CancellationToken ct) => Task.FromResult<IReadOnlyList<string>>([]);
}

public sealed class CancelOrderUseCase
{
    public Task ExecuteAsync(CancelOrderCommand command, CancellationToken ct) => Task.CompletedTask;
}

public sealed class OrderDraftUseCase
{
    public Task<OrderDraftResponse> GetAsync(Guid id, CancellationToken ct) => Task.FromResult(new OrderDraftResponse());

    public Task<OrderDraftResponse> SaveAsync(Guid id, SaveOrderDraftRequest request, CancellationToken ct) => Task.FromResult(new OrderDraftResponse());
}

public sealed record ListMembersResponse;

public sealed class ListMembersUseCase
{
    public Task<ListMembersResponse> ExecuteAsync(CancellationToken ct) => Task.FromResult(new ListMembersResponse());
}
