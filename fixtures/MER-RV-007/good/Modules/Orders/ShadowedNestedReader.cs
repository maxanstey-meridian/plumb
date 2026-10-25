namespace App.Modules.Orders;

public sealed class LineReader
{
    public int Status(RivetActionResult adapted) => adapted.StatusCode;
}

// Inside Outer.Inner, LineReader is Outer's own nested one, which reads nothing of the adapter's: the top-level
// LineReader that does is hidden.
public sealed class ShadowingOuter
{
    sealed class LineReader
    {
        public int Status(object value) => 200;
    }

    sealed class Inner
    {
        LineReader reader = new();

        public IResult Send(RivetActionResult adapted) => Results.StatusCode(reader.Status(adapted));
    }
}
