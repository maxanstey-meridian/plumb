using App.Contracts.Orders;

namespace App.Modules.Orders.Infrastructure;

// An adapter returning transport DTOs: no legal caller can use them, since Application and the published
// contract keep to the module's own types.
public sealed class OrderReader
{
    public Task<IReadOnlyList<OrderDto>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<OrderDto>>([]);
}
