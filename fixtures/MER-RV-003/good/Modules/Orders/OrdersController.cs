public sealed class OrdersController(CreateOrderUseCase useCase) : ControllerBase
{
    [HttpPost(OrdersContract.Create.Route)]
    public async Task<IActionResult> Create(CreateOrderRequest request, CancellationToken ct)
    {
        var endpoint = OrdersContract.Create.Bind(request);
        var result = await useCase.ExecuteAsync(new CreateOrderCommand(request.Name), ct);
        return endpoint.Success(new CreateOrderResponse(result.Id)).ToActionResult();
    }
}

[Route(OrdersContract.BaseRoute)]
public sealed class OrderListController(ListOrdersUseCase useCase) : ControllerBase
{
    [HttpGet(OrdersContract.List.Route)]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var orders = await useCase.ExecuteAsync(ct);
        return OrdersContract.List.Success(new ListOrdersResponse(orders)).ToActionResult();
    }
}

[Route(OrdersContract.BaseRoute)]
public sealed class OrderCancellationController(CancelOrderUseCase useCase) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Cancel(CancelOrderRequest request, CancellationToken ct)
    {
        var endpoint = OrdersContract.Cancel.Bind(request);
        await useCase.ExecuteAsync(new CancelOrderCommand(request.OrderId), ct);
        return endpoint.Success().ToActionResult();
    }
}
