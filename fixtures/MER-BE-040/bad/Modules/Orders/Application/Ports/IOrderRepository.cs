public interface IOrderRepository
{
    Task<PagedResult<IReadOnlyList<OrderDto>>> List(CancellationToken cancellationToken);
}
