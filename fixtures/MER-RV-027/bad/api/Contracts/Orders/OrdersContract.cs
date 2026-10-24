using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public const string GetRoute = "/api/orders/{id}";
    public const string CreateRoute = "/api/orders";
    public const string SettingsRoute = "/api/orders/settings";
    public const string ListRoute = "/api/orders";

    public static readonly RouteDefinition<App.Contracts.Orders.OrderDto> Get = Define.Get<App.Contracts.Orders.OrderDto>(GetRoute);

    public static readonly RouteDefinition<CreateOrderRequest, OrderDto> Create = Define.Post<
        CreateOrderRequest,
        OrderDto
    >(CreateRoute);

    public static readonly RouteDefinition<OrderSettingsDto, OrderSettingsDto> UpdateSettings =
        Define.Put<OrderSettingsDto, OrderSettingsDto>(SettingsRoute);

    public static readonly RouteDefinition<PaginatedResponse<OrderDto>> List = Define.Get<PaginatedResponse<OrderDto>>(ListRoute);
}

public sealed record CreateOrderRequest(string Name, string? Note = null);

public sealed record OrderDto(Guid Id, IReadOnlyList<OrderLineDto> Lines, string? Note = null);

public sealed record OrderLineDto(string Sku, [property: RivetOptional] int? Quantity, [property: RivetOptional] string? Warehouse = null);

public sealed record OrderSettingsDto(bool NotifyCustomer, int ReminderDays = 7);

// Not a shared Common envelope: its fields are always sent too.
public sealed record PaginatedResponse<T>(IReadOnlyList<T> Items, int Total = 0);
