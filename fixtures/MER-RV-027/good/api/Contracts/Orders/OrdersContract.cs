using System.Text.Json.Serialization;
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
        Define.Post<ImportOrdersRequest, ImportOrdersResponse>(ImportRoute)
            .Returns<OrderConflictResponse>(409, "Already imported")
            .Returns<ErrorResponse>(422, "Validation failed");
}

// Request-only: a default or a write-side JsonIgnore on what the client sends is not RV-027's concern.
public sealed record CreateOrderRequest(string Name, [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Note = null);

public sealed record OrderDto(Guid Id, IReadOnlyList<OrderLineDto> Lines, string? Note);

public sealed record OrderLineDto(string Sku, int? Quantity);

public sealed record ImportOrdersRequest(IReadOnlyList<CreateOrderRequest> Orders);

public sealed record ImportOrdersResponse(int Imported, IReadOnlyList<ErrorResponse> Failures);

// Always sent, null included; an unconditional [JsonIgnore] keeps a server-only field off the wire entirely.
public sealed record OrderConflictResponse(Guid OrderId, DateTimeOffset? SubmittedAt, [property: JsonIgnore] string? InternalTrace);
