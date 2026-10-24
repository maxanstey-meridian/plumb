public static class OrdersEndpoints
{
    public static void MapOrders(IEndpointRouteBuilder endpoints) =>
        endpoints.MapPost(
            OrdersContract.Create.Route,
            (CreateOrderRequest request) => useCase.ExecuteAsync(AdminOrdersContract.Create.Bind(request)));

    public static void MapDrafts(IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet(OrdersContract.DraftRoute, (Guid id) => useCase.ExecuteAsync(id));
}
