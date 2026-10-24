[RivetContract]
public static class OrdersContract
{
    public const string BaseRoute = "/api/orders";
    public const string DraftRoute = "/api/orders/{id}/draft";

    public static readonly RouteDefinition<OrderDraftResponse> GetDraft = Define.Get<OrderDraftResponse>(DraftRoute);

    public static readonly RouteDefinition<SaveOrderDraftRequest, OrderDraftResponse> SaveDraft = Define
        .Put<SaveOrderDraftRequest, OrderDraftResponse>(DraftRoute);
}
