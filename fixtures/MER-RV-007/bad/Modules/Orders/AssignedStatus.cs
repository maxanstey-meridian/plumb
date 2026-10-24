namespace App.Modules.Orders;

// Assigned from a read after its declaration, then built into a result.
public sealed class AssignedStatus : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        var status = 200;
        if (context.Result is RivetActionResult adapted) status = adapted.StatusCode;
        context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
