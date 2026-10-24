namespace App.Modules.Orders;

// Once reassigned, the local no longer holds the adapter's status.
public sealed class ReassignedStatus(ILogger<ReassignedStatus> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult adapted) return;
        var status = adapted.StatusCode;
        logger.LogInformation("adapted {Status}", status);
        status = 401;
        context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
