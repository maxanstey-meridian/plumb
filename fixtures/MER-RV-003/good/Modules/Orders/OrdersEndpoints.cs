public static class OrdersEndpoints
{
    public static void MapOrders(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(
            OrdersContract.Create.Route,
            (CreateOrderRequest request) =>
                OrdersContract.Create.Invoke(() => useCase.ExecuteAsync(request)));
}
