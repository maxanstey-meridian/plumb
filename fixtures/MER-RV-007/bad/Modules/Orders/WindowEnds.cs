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

// A reassignment that reads the local after a lambda's block, in the same statement, still holds the adapter's
// status.
public sealed class LambdaArgumentStatus
{
    public IResult Send(RivetActionResult adapted)
    {
        var status = adapted.StatusCode;
        status = Pick(() => { return 1; }, status);
        return Results.StatusCode(status);
    }

    private static int Pick(Func<int> fallback, int current) => current;
}

public sealed record PickOptions(object? Seed)
{
    public Func<int>? OnError { get; init; }
}

// So does one after a lambda's block inside an object initializer's braces.
public sealed class InitializerLambdaStatus
{
    public IResult Send(RivetActionResult adapted)
    {
        var status = adapted.StatusCode;
        status = Pick(new PickOptions(null) { OnError = () => { return 1; } }, status);
        return Results.StatusCode(status);
    }

    private static int Pick(PickOptions options, int current) => current;
}

// An assignment inside an if's braces may not run either.
public sealed class BracedConditionStatus : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult adapted) return;
        var status = adapted.StatusCode;
        if (status > 500) { status = 500; }
        context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}

// Nor may one after else.
public sealed class ElseStatus(ILogger<ElseStatus> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult adapted) return;
        var status = adapted.StatusCode;
        if (status < 500) logger.LogInformation("adapted {Status}", status); else status = 500;
        context.Result = new ObjectResult(null) { StatusCode = status };
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}

// A lambda's own local of the same name hides only its own uses: a later declaration in that lambda, read from the
// adapter again, is followed too.
public sealed class CastFirstLambdaStatus(ILogger<CastFirstLambdaStatus> logger)
{
    public IEnumerable<IResult> Send(IActionResult result, RivetActionResult adapted, List<int> items)
    {
        var status = ((RivetActionResult)result).StatusCode;
        logger.LogInformation("adapted {Status}", status);
        return items.Select(i => { var status = adapted.StatusCode; return Results.StatusCode(status); });
    }
}
