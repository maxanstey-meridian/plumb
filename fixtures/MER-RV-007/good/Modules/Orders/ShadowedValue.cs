namespace App.Modules.Orders;

public sealed record Line(string Name);

// A lambda's own parameter shadows the local of that name.
public sealed class ShadowedValue(ILogger<ShadowedValue> logger)
{
    public IResult List(IActionResult result, List<Line> items)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var value = adapted.Value;
        logger.LogInformation("adapted {Value}", value);
        return Results.Ok(items.Select(value => value.Name));
    }
}
