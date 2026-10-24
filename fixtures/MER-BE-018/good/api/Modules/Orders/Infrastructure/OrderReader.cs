using App.Modules.Orders.Contracts;

namespace App.Modules.Orders.Infrastructure;

// The adapter reads into the module's own published type; the controller maps it to transport.
public sealed class OrderReader
{
    public Task<IReadOnlyList<OrderSummary>> ListAsync(CancellationToken ct) =>
        Task.FromResult<IReadOnlyList<OrderSummary>>([]);
}
