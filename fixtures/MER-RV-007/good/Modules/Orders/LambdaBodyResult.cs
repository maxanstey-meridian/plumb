namespace App.Modules.Orders;

// A statement split by a lambda's block is judged by its own pieces: the result the lambda builds is the lambda's,
// not the logging statement's that reads the adapter's status.
public sealed class LambdaBodyResult(ILogger<LambdaBodyResult> logger)
{
    public void Log(RivetActionResult adapted, List<int> items)
    {
        logger.LogInformation("adapted {Count} {Status}", items.Count(i => { return Results.Ok(i) is not null; }), adapted.StatusCode);
    }
}
