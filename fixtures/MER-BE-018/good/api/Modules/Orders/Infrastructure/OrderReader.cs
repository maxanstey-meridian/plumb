using App.Contracts.Orders;

namespace App.Modules.Orders.Infrastructure;

// Infrastructure sits outside the published contract, domain and use cases.
public sealed class OrderReader
{
    public Task<IReadOnlyList<OrderDto>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<OrderDto>>([]);
}
