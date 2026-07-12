public interface IOrderRepository
{
    Task<IReadOnlyList<Order>> List(CancellationToken cancellationToken);
    Task<MutationReceiptDto> Save(Order order, CancellationToken cancellationToken);
}


public interface IOrderQuery
{
    Task<OrderDto> List(CancellationToken cancellationToken);
}
