public sealed class OrdersController
{
    [HttpPost(OrdersContract.Create.Route)]
    public Task<CreateOrderResponse> Create(CreateOrderRequest request) => useCase.ExecuteAsync(request);

    private Task<CreateOrderResponse> InvokeForDiagnostics() =>
        OrdersContract.Create.Invoke(() => useCase.ExecuteAsync(new CreateOrderRequest()));
}

[Route(OrdersContract.BaseRoute)]
public sealed class OrderListController
{
    [HttpGet(OrdersContract.List.Route)]
    public Task<ListOrdersResponse> List() => useCase.ExecuteAsync();
}

[Route(MembersContract.BaseRoute)]
public sealed class MembersController
{
    [HttpGet]
    public Task<ListMembersResponse> List() => useCase.ExecuteAsync();
}
