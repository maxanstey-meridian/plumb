namespace App.Modules.Orders;

// A controller deriving from the app's own base has ControllerBase's helpers too.
public abstract class ApiControllerBase : ControllerBase { }

public sealed class DerivedRelayController : ApiControllerBase
{
    public IActionResult List()
    {
        var a = (RivetActionResult)OrdersContract.List.Success(new OrderPage()).ToActionResult();
        return Ok(a.Value);
    }
}

// The app's own result type, set on a context named ctx, is a result of its own all the same.
public sealed record Envelope(object? Data) : IActionResult
{
    public Task ExecuteResultAsync(ActionContext context) => new ObjectResult(this).ExecuteResultAsync(context);
}

public sealed class EnvelopeFilter : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext ctx)
    {
        if (ctx.Result is not RivetActionResult a) return;
        ctx.Result = new Envelope(a.Value);
    }

    public void OnResultExecuted(ResultExecutedContext ctx) { }
}

// A response held in a local is written all the same.
public sealed class LocalResponseFilter : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not RivetActionResult a) return;
        var response = context.HttpContext.Response;
        response.StatusCode = a.StatusCode ?? StatusCodes.Status200OK;
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
