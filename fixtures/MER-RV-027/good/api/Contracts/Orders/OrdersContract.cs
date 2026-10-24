using App.Common;
using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public const string GetRoute = "/api/orders/{id}";
    public const string CreateRoute = "/api/orders";
    public const string ImportRoute = "/api/orders/import";

    public static readonly RouteDefinition<App.Contracts.Orders.OrderDto> Get = Define.Get<App.Contracts.Orders.OrderDto>(GetRoute);

    public static readonly RouteDefinition<CreateOrderRequest, OrderDto> Create = Define.Post<
        CreateOrderRequest,
        OrderDto
    >(CreateRoute);

    public static readonly RouteDefinition<ImportOrdersRequest, ImportOrdersResponse> Import =
        Define.Post<ImportOrdersRequest, ImportOrdersResponse>(ImportRoute);
}

public sealed record CreateOrderRequest(string Name, string? Note = null);

public sealed record OrderDto(Guid Id, IReadOnlyList<OrderLineDto> Lines, string? Note);

public sealed record OrderLineDto(string Sku, int? Quantity);

public sealed record ImportOrdersRequest(IReadOnlyList<CreateOrderRequest> Orders);

public sealed record ImportOrdersResponse(int Imported, IReadOnlyList<ErrorResponse> Failures);
