using System.Text.Json.Serialization;
using Rivet;

namespace App.Contracts.Orders;

[RivetContract]
public static class OrderNotesContract
{
    public static readonly RouteDefinition<AddOrderNoteRequest, OrderNoteDto> Add =
        Define.Post<AddOrderNoteRequest, OrderNoteDto>("/api/orders/{id}/notes");
}

// Request-only: a class with optional properties is the client's to fill.
public sealed class AddOrderNoteRequest
{
    public string Text { get; init; } = "";

    [RivetOptional]
    public string? Author { get; init; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Tag { get; init; }
}

// Body properties a builder can't leave out: computed, get-only, privately set, or static.
public sealed record OrderNoteDto(Guid Id, string Text, OrderNoteKind Kind, OrderNoteAt At, OrderNotePing Ping)
{
    public string Preview => Text.Length > 20 ? Text[..20] : Text;

    public int Length { get; } = Text.Length;

    public bool Edited { get; private set; }

    public static OrderNoteDto? Last { get; set; }
}

public enum OrderNoteKind
{
    Plain,
    Pinned,
}

// A union base with no fields of its own: its abstract and computed properties are each case's to send.
[JsonPolymorphic(TypeDiscriminatorPropertyName = "$kind")]
[JsonDerivedType(typeof(Created), "created")]
[JsonDerivedType(typeof(Edited), "edited")]
public abstract partial record OrderNoteAt
{
    public abstract DateTimeOffset At { get; init; }

    public string Describe => GetType().Name;

    public sealed partial record Created(DateTimeOffset At) : OrderNoteAt
    {
        public override DateTimeOffset At { get; init; } = At;
    }

    // A case overriding the base's abstract member in its body: the override is the base's field, not a new one.
    public sealed partial record Edited(DateTimeOffset At, string By) : OrderNoteAt
    {
        public override DateTimeOffset At { get; init; } = At;
    }
}

// No fields at all.
public sealed record OrderNotePing;
