namespace App.Modules.Orders;

// A local function's own parameter shadows the local of that name, block-bodied, expression-bodied or after a where
// clause.
public sealed class LocalFunctionShadow(ILogger<LocalFunctionShadow> logger)
{
    public IResult Block(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        IResult Show(Line value) { return Results.Ok(value.Name); }
        return Show(items[0]);
    }

    public IResult Expression(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        IResult Show(Line value) => Results.Ok(value.Name);
        return Show(items[0]);
    }

    public IResult Constrained(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        IResult Show<T>(T value) where T : class { return Results.Ok(value); }
        return Show(items[0]);
    }
}

// A local function's return is its own, after a where clause too: Code returns no read.
public sealed class ConstrainedLocalReturn(ILogger<ConstrainedLocalReturn> logger)
{
    public int Code(RivetActionResult adapted)
    {
        int Read<T>(T unused) where T : class { return adapted.StatusCode; }
        logger.LogInformation("adapted {Status}", Read(""));
        return 0;
    }

    public IResult Send(RivetActionResult adapted) => Results.StatusCode(Code(adapted));
}

// A local function hides the member of its name in the block that declares it: this Status(…) is the local one.
public sealed class LocalFunctionNamesake
{
    private int Status(RivetActionResult adapted) => adapted.StatusCode;

    public IResult Send(List<Line> items)
    {
        int Status(int count) => count;
        return Results.StatusCode(Status(items.Count));
    }
}
