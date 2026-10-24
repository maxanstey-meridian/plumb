namespace App.Modules.Orders;

// Copied through locals first, then built into a result of its own.
public sealed class LocalCopyFilter : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult adapted) return;
        var status = adapted.StatusCode;
        var payload = adapted.Value;
        context.Result = new ObjectResult(new { data = payload }) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
