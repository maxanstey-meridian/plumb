namespace App.Modules.Orders;

// A typed lambda parameter, one of several parameters and a lambda's own local shadow the local of that name.
public sealed class TypedLambdaShadow(ILogger<TypedLambdaShadow> logger)
{
    public IResult Typed(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        return Results.Ok(items.Select((Line value) => value.Name));
    }

    public IResult Several(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        return Results.Ok(items.Select((value, index) => value.Name));
    }

    public IEnumerable<IResult> Local(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return [];
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        return items.Select(item => { var value = item.Name; return Results.Ok(value); });
    }
}
