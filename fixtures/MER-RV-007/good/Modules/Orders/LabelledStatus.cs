namespace App.Modules.Orders;

// A named argument's label is not the local of that name.
public sealed class LabelledStatus(ILogger<LabelledStatus> logger)
{
    public IResult Send(IActionResult result)
    {
        if (result is not RivetActionResult adapted) return Results.Ok();
        var statusCode = adapted.StatusCode;
        logger.LogInformation("adapted {Status}", statusCode);
        return Results.Json(new ProblemDetails(), statusCode: 500);
    }
}
