public static class OrdersEndpoints
{
    public static IEndpointRouteBuilder MapOrdersEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(
            OrdersContract.Create.Route,
            async (CreateOrderRequest request, CreateOrderUseCase useCase, CancellationToken ct) =>
            {
                var endpoint = OrdersContract.Create.Bind(request);
                var result = await useCase.ExecuteAsync(new CreateOrderCommand(request.Name), ct);
                return endpoint.Success(new CreateOrderResponse(result.Id)).ToResult();
            });

        endpoints.MapGet(
            OrdersContract.List.Route,
            async (ListOrdersUseCase useCase, CancellationToken ct) =>
                OrdersContract.List.Success(new ListOrdersResponse(await useCase.ExecuteAsync(ct))).ToResult());

        return endpoints;
    }
}
