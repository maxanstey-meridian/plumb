namespace App.Modules.Orders;

// An MVC result filter may read the status Rivet's adapter declared; Rivet still writes the response. Refusing an
// anonymous caller in another statement copies nothing of the adapter's, and a condition only decides.
public sealed class StatusLoggingFilter(ILogger<StatusLoggingFilter> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is RivetActionResult adapted) logger.LogInformation("responding {Status}", adapted.StatusCode);
        else if (context.HttpContext.User.Identity?.IsAuthenticated != true) context.Result = new UnauthorizedResult();
        if (context.Result is RivetActionResult shown && shown.Value is not null && context.HttpContext.Response.Body.CanWrite)
        {
            logger.LogDebug("responding with a body");
        }
        if (context.Result is RivetActionResult { } denied && denied.StatusCode == 403)
        {
            context.HttpContext.Items["denied"] = true;
        }
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
