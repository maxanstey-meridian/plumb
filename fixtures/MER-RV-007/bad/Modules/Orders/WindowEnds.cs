namespace App.Modules.Orders;

// A reassignment that reads the local still holds the adapter's status.
public sealed class ClampedStatus : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult adapted) return;
        var status = adapted.StatusCode;
        status = Math.Min(status, 500);
        context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}

// A conditional assignment may not run, so the local may still hold the adapter's status.
public sealed class ConditionalStatus : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult adapted) return;
        var status = adapted.StatusCode;
        if (status > 500) status = 500;
        context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}

public sealed record Item(int Code);

// A lambda's own local of the same name is not the outer one.
public sealed class LambdaLocalStatus(ILogger<LambdaLocalStatus> logger)
{
    public IResult Send(RivetActionResult adapted, List<Item> items)
    {
        var status = adapted.StatusCode;
        items.ForEach(i => { var status = i.Code; logger.LogInformation("item {Status}", status); });
        return Results.StatusCode(status);
    }
}
