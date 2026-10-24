public static class OrdersEndpoints
{
    public static IEndpointRouteBuilder MapOrders(IEndpointRouteBuilder endpoints)
    {
        // Legacy .Invoke form — still recognized during the terminal transition.
        endpoints.MapPost(
            OrdersContract.Create.Route,
            (CreateOrderRequest request) =>
                OrdersContract.Create.Invoke(() => useCase.ExecuteAsync(request)));

        // Current bind/terminal form — endpoint.Success + .ToResult at the edge.
        endpoints.MapPost(
            MembersContract.Create.Route,
            (CreateMemberRequest request) =>
            {
                var endpoint = MembersContract.Create.Bind(request);
                return endpoint.Success(useCase.Execute(request)).ToResult();
            });

        return endpoints;
    }
}
