[RivetContract]
public static class OrdersContract
{
    public const string BaseRoute = "/api/orders";
    public const string CreateRoute = "/api/orders";
    public const string ListRoute = "/api/orders";
    public const string DraftRoute = "/api/orders/{id}/draft";

    public static readonly RouteDefinition<CreateOrderRequest, CreateOrderResponse> Create = Define
        .Post<CreateOrderRequest, CreateOrderResponse>(CreateRoute);

    public static readonly RouteDefinition<ListOrdersResponse> List = Define.Get<ListOrdersResponse>(ListRoute);

    public static readonly RouteDefinition<OrderDraftResponse> GetDraft = Define.Get<OrderDraftResponse>(DraftRoute);

    public static readonly RouteDefinition<SaveOrderDraftRequest, OrderDraftResponse> SaveDraft = Define
        .Put<SaveOrderDraftRequest, OrderDraftResponse>(DraftRoute);
}
