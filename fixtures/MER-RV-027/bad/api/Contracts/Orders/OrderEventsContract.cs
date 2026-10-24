using System.Text.Json.Serialization;
using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrderEventsContract
{
    public static readonly RouteDefinition<OrderEventDto> Latest = Define.Get<OrderEventDto>("/api/orders/{id}/events/latest");
}

// Positional, with fields a builder can still leave out in its body.
public sealed record OrderEventDto(Guid Id, OrderEventKind Kind)
{
    public string? Actor { get; init; }

    [RivetOptional]
    public required int? Sequence { get; set; }

    public string Display => $"{Id}";

    public DateTimeOffset Recorded { get; } = DateTimeOffset.UtcNow;

    public string? Source { get; private set; }
}

// A union base: no fields of its own, but each case it names is a response.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$kind")]
[JsonDerivedType(typeof(Placed), "placed")]
[JsonDerivedType(typeof(OrderCancelled), "cancelled")]
public abstract partial record OrderEventKind
{
    public abstract Guid OrderId { get; init; }

    public sealed partial record Placed(Guid OrderId, [property: RivetOptional] string? Channel = null) : OrderEventKind
    {
        public override Guid OrderId { get; init; } = OrderId;
    }
}

// A case declared beside its base.
public sealed record OrderCancelled(Guid OrderId, string? Reason = null) : OrderEventKind
{
    public override Guid OrderId { get; init; } = OrderId;
}
