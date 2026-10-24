namespace App.Modules.Orders;

// An MVC result filter may read the status Rivet's adapter declared; Rivet still writes the response. Refusing an
// anonymous caller in another statement copies nothing of the adapter's.
public sealed class StatusLoggingFilter(ILogger<StatusLoggingFilter> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is RivetActionResult adapted) logger.LogInformation("responding {Status}", adapted.StatusCode);
        else if (context.HttpContext.User.Identity?.IsAuthenticated != true) context.Result = new UnauthorizedResult();
        if (context.Result is RivetActionResult { } denied && denied.StatusCode == 403)
        {
            context.Result = new UnauthorizedResult();
        }
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
