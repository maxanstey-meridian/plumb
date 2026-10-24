namespace App.Modules.Orders;

// A local declared in one block ends with it: another block's local of that name, and a later loop variable of
// that name, are their own.
public sealed class RedeclaredStatus(ILogger<RedeclaredStatus> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is RivetActionResult adapted)
        {
            var status = adapted.StatusCode;
            logger.LogInformation("adapted {Status}", status);
        }
        else
        {
            var status = 401;
            context.Result = new ObjectResult(null) { StatusCode = status };
        }
        foreach (var status in new[] { 401, 403 }) context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
