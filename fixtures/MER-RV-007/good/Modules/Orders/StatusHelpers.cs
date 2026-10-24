namespace App.Modules.Orders;

public sealed record Page(object? Content)
{
    public object? Body() => Content;
}

// Helpers and a nested reader that hand back the adapter's output, called only to log it; another type's own
// Body() is not the reader's.
public sealed class StatusHelpers(ILogger<StatusHelpers> logger)
{
    private sealed class Reader(RivetActionResult adapted)
    {
        public object? Body() => adapted.Value;
    }

    private static int Status(RivetActionResult adapted) => adapted.StatusCode;

    public IResult Send(RivetActionResult adapted, Page page)
    {
        logger.LogInformation("{Status}: {Body}", Status(adapted), new Reader(adapted).Body());
        return Results.Ok(page.Body());
    }
}
