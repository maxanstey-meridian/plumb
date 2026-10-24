public sealed class OrdersController
{
    [HttpPost(OrdersContract.Create.Route)]
    public Task<CreateOrderResponse> Create(CreateOrderRequest request) => useCase.ExecuteAsync(request);

    private object BindForDiagnostics(CreateOrderRequest request) =>
        OrdersContract.Create.Bind(request);
}

[Route(OrdersContract.BaseRoute)]
public sealed class OrderListController
{
    [HttpGet(OrdersContract.List.Route)]
    public Task<ListOrdersResponse> List() => useCase.ExecuteAsync(); // OrdersContract.List.Success(...) is a comment
}

[Route(MembersContract.BaseRoute)]
public sealed class MembersController
{
    [HttpGet]
    public Task<ListMembersResponse> List() => useCase.ExecuteAsync();
}
