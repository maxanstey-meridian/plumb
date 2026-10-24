namespace App.Modules.Orders;

// A local function's own parameter shadows the local of that name, block-bodied or expression-bodied.
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
}
