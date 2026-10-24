using System.Text.Json.Serialization;
using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public const string GetRoute = "/api/orders/{id}";
    public const string CreateRoute = "/api/orders";
    public const string SettingsRoute = "/api/orders/settings";
    public const string ListRoute = "/api/orders";
    public const string SubmitRoute = "/api/orders/{id}/submit";

    public static readonly RouteDefinition<App.Contracts.Orders.OrderDto> Get = Define.Get<App.Contracts.Orders.OrderDto>(GetRoute);

    public static readonly RouteDefinition<CreateOrderRequest, OrderDto> Create = Define.Post<
        CreateOrderRequest,
        OrderDto
    >(CreateRoute);

    public static readonly RouteDefinition<OrderSettingsDto, OrderSettingsDto> UpdateSettings =
        Define.Put<OrderSettingsDto, OrderSettingsDto>(SettingsRoute);

    public static readonly RouteDefinition<PaginatedResponse<OrderDto>> List = Define.Get<PaginatedResponse<OrderDto>>(ListRoute);

    // Declared error responses are responses too; ErrorResponse stays exempt by name.
    public static readonly RouteDefinition<CreateOrderRequest, OrderDto> Submit =
        Define.Post<CreateOrderRequest, OrderDto>(SubmitRoute)
            .Returns<OrderConflictResponse>(409, "Already submitted")
            .Returns<ErrorResponse>(422, "Validation failed");
}

public sealed record CreateOrderRequest(string Name, string? Note = null);

public sealed record OrderDto(Guid Id, IReadOnlyList<OrderLineDto> Lines, string? Note = null);

public sealed record OrderLineDto(string Sku, [property: RivetOptional] int? Quantity, [property: RivetOptional] string? Warehouse = null);

public sealed record OrderSettingsDto(bool NotifyCustomer, int ReminderDays = 7);

// Not a shared Common envelope: its fields are always sent too.
public sealed record PaginatedResponse<T>(IReadOnlyList<T> Items, int Total = 0);

public sealed record OrderConflictResponse(
    Guid OrderId,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] DateTimeOffset? SubmittedAt,
    [property: JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] int Attempts,
    string Reason = "duplicate");

public sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors = null);
