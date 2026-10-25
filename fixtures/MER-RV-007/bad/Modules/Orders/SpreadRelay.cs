namespace App.Modules.Orders;

// A spread's `..` is no member access: a local read from the adapter's output, spread into a result,
public sealed class SpreadLocalRelay
{
    public IResult Send(RivetActionResult adapted)
    {
        var rows = (IEnumerable<object>)adapted.Value!;
        return Results.Json([.. rows]);
    }
}

// a member call that returns a read,
public sealed class SpreadMemberRelay
{
    RivetActionResult adapted = null!;

    IEnumerable<object> Rows() => (IEnumerable<object>)adapted.Value!;

    public IResult Send() => Results.Json([.. Rows()]);
}

public static class RowReader
{
    public static IEnumerable<object> Rows(RivetActionResult adapted) => (IEnumerable<object>)adapted.Value!;
}

// a sibling type's static helper,
public sealed class SpreadStaticRelay
{
    public IResult Send(RivetActionResult adapted) => Results.Json([.. RowReader.Rows(adapted)]);
}

// and a nested reader bound to a name.
public sealed class SpreadBoundRelay
{
    sealed class Reader(RivetActionResult adapted)
    {
        public IEnumerable<object> Rows => (IEnumerable<object>)adapted.Value!;
    }

    public IResult Send(RivetActionResult adapted)
    {
        Reader reader = new(adapted);
        return Results.Json([.. reader.Rows]);
    }
}
