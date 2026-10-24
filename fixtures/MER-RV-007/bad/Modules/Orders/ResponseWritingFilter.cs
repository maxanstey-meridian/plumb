namespace App.Modules.Orders;

// A result filter that writes the adapter's status and value to the response itself instead of letting Rivet.
public sealed class ResponseWritingFilter : IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        if (context.Result is not RivetActionResult adapted)
        {
            await next();
            return;
        }
        context.HttpContext.Response.StatusCode = adapted.StatusCode;
        await context.HttpContext.Response.WriteAsJsonAsync(adapted.Value);
    }
}
