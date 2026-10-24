namespace App.Modules.Orders;

// A nested reader's static helper, called on its type.
public sealed class StaticNestedReader
{
    private static class Reader
    {
        public static object? Body(RivetActionResult adapted) => adapted.Value;
    }

    public IResult Send(RivetActionResult adapted) => Results.Ok(Reader.Body(adapted));
}

// A nested reader reached through a cast.
public sealed class CastNestedReader
{
    private sealed class Reader(RivetActionResult adapted)
    {
        public object? Body() => adapted.Value;
    }

    public IResult Send(object reader) => Results.Ok(((Reader)reader).Body());
}

// A nested reader held in a field.
public sealed class FieldNestedReader(RivetActionResult adapted)
{
    private sealed class Reader(RivetActionResult adapted)
    {
        public object? Body() => adapted.Value;
    }

    private readonly Reader held = new(adapted);

    public IResult Send() => Results.Ok(held.Body());
}

// A grandchild reader, constructed through its parent's name.
public sealed class GrandchildReader
{
    private static class Mid
    {
        public sealed class Leaf(RivetActionResult adapted)
        {
            public int S => adapted.StatusCode;
        }
    }

    public IResult Send(RivetActionResult adapted) => Results.StatusCode(new Mid.Leaf(adapted).S);
}
