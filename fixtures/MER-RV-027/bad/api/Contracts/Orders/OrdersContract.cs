using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public const string GetRoute = "/api/orders/{id}";
    public const string CreateRoute = "/api/orders";

    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>(GetRoute);

    public static readonly RouteDefinition<CreateOrderRequest, OrderDto> Create = Define.Post<
        CreateOrderRequest,
        OrderDto
    >(CreateRoute);
}

public sealed record CreateOrderRequest(string Name, string? Note = null);

public sealed record OrderDto(Guid Id, IReadOnlyList<OrderLineDto> Lines, string? Note = null);

public sealed record OrderLineDto(string Sku, [property: RivetOptional] int? Quantity);
