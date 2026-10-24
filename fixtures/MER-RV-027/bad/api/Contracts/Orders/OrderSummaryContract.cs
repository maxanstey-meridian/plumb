using System.Text.Json.Serialization;
using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrderSummaryContract
{
    public static readonly RouteDefinition<OrderSummaryView> Get = Define.Get<OrderSummaryView>("/api/orders/{id}/summary");

    public static readonly RouteDefinition<OrderHistoryDto> History = Define.Get<OrderHistoryDto>("/api/orders/{id}/history");

    public static readonly RouteDefinition<OrderTagsView> Tags = Define.Get<OrderTagsView>("/api/orders/{id}/tags");
}

// A class: its fields are properties.
public sealed class OrderSummaryView
{
    public Guid Id { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Note { get; init; }

    [RivetOptional]
    public int? Priority { get; set; }

    public OrderTotalsView Totals { get; init; } = new(0);

    public string Label => $"Order {Id}";

    // Never sent, so its type isn't followed.
    [JsonIgnore]
    public InternalAudit Audit { get; init; } = new();

    public static OrderSummaryView Empty { get; } = new();

    public OrderSummaryView WithNote(string note) => new() { Id = Id, Note = note };
}

// Reached through OrderSummaryView.Totals: the walk keeps following property types.
public sealed record OrderTotalsView(decimal Amount, string Currency = "GBP");

public sealed record InternalAudit(string By = "system");

// A record without a positional parameter list; its nested entry type is seen from the property.
public sealed record OrderHistoryDto
{
    public required IReadOnlyList<Entry> Entries { get; init; }

    public sealed record Entry(DateTimeOffset At, string? By = null);
}

// One partial class in two parts: flagged once, at the first.
public partial class OrderTagsView
{
    public IReadOnlyList<string> Names { get; init; } = [];
}

public partial class OrderTagsView
{
    [property: RivetOptional]
    public string? Colour { get; init; }
}
