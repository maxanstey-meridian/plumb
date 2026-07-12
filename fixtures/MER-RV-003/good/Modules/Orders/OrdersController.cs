public sealed class OrdersController
{
    [HttpPost(OrdersContract.Create.Route)]
    public Task<CreateOrderResponse> Create(CreateOrderRequest request) =>
        OrdersContract.Create.Invoke(() => useCase.ExecuteAsync(request));
}

[Route(OrdersContract.BaseRoute)]
public sealed class OrderListController
{
    [HttpGet(OrdersContract.List.Route)]
    public Task<ListOrdersResponse> List() =>
        OrdersContract.List.Invoke(() => useCase.ExecuteAsync());
}

[Route(MembersContract.BaseRoute)]
public sealed class MembersController
{
    [HttpGet]
    public Task<ListMembersResponse> List() =>
        MembersContract.List.Invoke(() => useCase.ExecuteAsync());
}
