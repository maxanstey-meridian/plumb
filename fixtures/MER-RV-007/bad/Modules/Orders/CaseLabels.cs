namespace App.Modules.Orders;

// A declaration after a switch section's label is followed like any other: after `case 1:`,
public sealed class CaseLabelStatus
{
    public IResult Send(RivetActionResult adapted, int kind)
    {
        switch (kind)
        {
            case 1:
                var status = adapted.StatusCode;
                return Results.StatusCode(status);
            default:
                return Results.Ok();
        }
    }
}

// after a `when` whose ?: has a `:` of its own,
public sealed class GuardedLabelStatus
{
    public IResult Send(RivetActionResult adapted, object kind, bool strict)
    {
        switch (kind)
        {
            case int code when strict ? code > 1 : code > 2:
                var status = adapted.StatusCode;
                return Results.StatusCode(status);
            default:
                return Results.Ok();
        }
    }
}

// after a property pattern's label, whose `:` is inside its braces,
public sealed class PatternLabelStatus
{
    public IResult Send(RivetActionResult adapted, string kind)
    {
        switch (kind)
        {
            case { Length: 2 }:
                var status = adapted.StatusCode;
                return Results.StatusCode(status);
            default:
                return Results.Ok();
        }
    }
}

// after a type pattern whose type argument is nullable, its `?` no ?:,
public sealed class NullableLabelStatus
{
    public IResult Send(RivetActionResult adapted, object kind)
    {
        switch (kind)
        {
            case List<int?> list:
                var status = adapted.StatusCode;
                return Results.StatusCode(status);
            default:
                return Results.Ok();
        }
    }
}

// and after `default:`.
public sealed class DefaultLabelStatus
{
    public IResult Send(RivetActionResult adapted, int kind)
    {
        switch (kind)
        {
            case 1:
                return Results.Ok();
            default:
                var status = adapted.StatusCode;
                return Results.StatusCode(status);
        }
    }
}
