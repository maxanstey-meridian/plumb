namespace App.Modules.Orders;

// An MVC result filter may read the status Rivet's adapter declared; Rivet still writes the response.
public sealed class StatusLoggingFilter(ILogger<StatusLoggingFilter> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is RivetActionResult adapted) logger.LogInformation("responding {Status}", adapted.StatusCode);
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
