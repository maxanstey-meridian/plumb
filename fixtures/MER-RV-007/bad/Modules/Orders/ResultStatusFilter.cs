namespace App.Modules.Orders;

// An endpoint filter that rewrites whatever Rivet's adapter returned.
public sealed class ResultStatusFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var result = await next(context);
        return result is global::Rivet.RivetActionResult adapted ? Results.Json(adapted.Value) : result;
    }
}
