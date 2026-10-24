namespace App.Modules.Orders;

// One method's pattern binding reaches only that method: another method's own `result` is FluentResults', not
// Rivet's adapter output.
public sealed class OrderAudit(ILogger<OrderAudit> logger)
{
    public void Log(IActionResult adapted)
    {
        if (adapted is RivetActionResult result) logger.LogInformation("responding {Status}", result.StatusCode);
    }

    public IResult Describe(Result<OrderPage> result) => Results.Ok(result.Value);
}
