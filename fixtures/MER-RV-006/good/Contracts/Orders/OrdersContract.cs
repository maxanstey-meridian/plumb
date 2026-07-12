[RivetContract]
public static class OrdersContract
{
    public const string BaseRoute = "/api/orders";
    public static readonly RouteDefinition<CreateRequest, CreateResponse> Create =
        Define.Post<CreateRequest, CreateResponse>(BaseRoute);
    public static readonly Rivet.RouteDefinition List = Define.Get(BaseRoute);
    public static readonly global::Rivet.InputRouteDefinition<CreateRequest> Import = Define.Post(BaseRoute);
}

public sealed class OrdersClient
{
    public string BuildUrl() => OrdersContract.BaseRoute;

    private const string CompilerFixture = """
        [RivetContract]
        public class InvalidContract { public void Run() { } }
        """;
}
