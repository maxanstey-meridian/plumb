public static class FunctionResultExtensions
{
    // An Azure Functions bridge: it calls the adapter only to copy its status and body into the worker's response.
    public static async Task<HttpResponseData> ToResponse(this RivetResult result, HttpRequestData request)
    {
        var adapted = (RivetActionResult)result.ToActionResult();
        var response = request.CreateResponse((HttpStatusCode)adapted.StatusCode);
        await response.WriteAsJsonAsync(adapted.Value);
        return response;
    }

    // Calls the adapter, then rebuilds its output as a result of its own.
    public static IActionResult Rebuild(this RivetResult result)
    {
        var adapted = (RivetActionResult)result.ToActionResult();
        return new ObjectResult(adapted.Value) { StatusCode = adapted.StatusCode };
    }

    // Hand-writes the error path beside the adapter.
    public static IResult ToHttp(this RivetResult result) => result.IsError ? Results.Problem() : result.ToResult();

    // One arm skips the adapter.
    public static IResult OneArm(this RivetResult result, IResult other, bool flag) => flag ? other : result.ToResult();

    // Named like the adapter, returning something else: a handler's .ToResult() may bind to it.
    public static object ToResult(this RivetResult<Order> result) => result;
}
