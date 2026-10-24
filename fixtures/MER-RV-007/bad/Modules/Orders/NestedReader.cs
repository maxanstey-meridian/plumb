namespace App.Modules.Orders;

// A nested class reads the adapter's output; the class around it builds the result from what it hands back.
public sealed class NestedReader
{
    private sealed class Reader(RivetActionResult adapted)
    {
        public object? Body() => adapted.Value;
    }

    public IActionResult Send(RivetActionResult adapted) => new ObjectResult(new Reader(adapted).Body());
}

// The same, through a local bound to the nested reader.
public sealed class NestedLocalReader
{
    private sealed class Reader(RivetActionResult adapted)
    {
        public int Status => adapted.StatusCode;
    }

    public IResult Send(RivetActionResult adapted)
    {
        var reader = new Reader(adapted);
        return Results.StatusCode(reader.Status);
    }
}
