public sealed class OrdersController(CreateOrderUseCase useCase) : ControllerBase
{
    [HttpPost(OrdersContract.CreateRoute)]
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
    [HttpGet(OrdersContract.ListRoute)]
    public async Task<IActionResult> List(CancellationToken ct) =>
        OrdersContract
            .List.Success(new ListOrdersResponse(await useCase.ExecuteAsync(ct)))
            .ToActionResult();
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

// DraftRoute serves two fields: each action answers through the one its verb defines.
public sealed class OrderDraftsController(OrderDraftUseCase useCase) : ControllerBase
{
    [HttpGet(OrdersContract.DraftRoute)]
    public async Task<IActionResult> GetDraft(Guid id, CancellationToken ct)
    {
        var endpoint = OrdersContract.GetDraft;
        var draft = await useCase.GetAsync(id, ct);
        return endpoint.Success(draft).ToActionResult();
    }

    [HttpPut(OrdersContract.DraftRoute)]
    public async Task<IActionResult> SaveDraft(Guid id, SaveOrderDraftRequest request, CancellationToken ct) =>
        OrdersContract.SaveDraft.Bind(request).Success(await useCase.SaveAsync(id, request, ct)).ToActionResult();

    // CallbackRoute backs no contract field: a plain redirect handler, not a Rivet endpoint.
    [HttpGet(OrdersContract.CallbackRoute)]
    public IActionResult PaymentCallback() => Redirect("/orders");
}

// MembersContract is outside this scan, so any of its fields answers.
public sealed class MembersController(ListMembersUseCase useCase) : ControllerBase
{
    [HttpGet(MembersContract.ListRoute)]
    public async Task<IActionResult> List(CancellationToken ct) =>
        MembersContract.List.Success(await useCase.ExecuteAsync(ct)).ToActionResult();
}
