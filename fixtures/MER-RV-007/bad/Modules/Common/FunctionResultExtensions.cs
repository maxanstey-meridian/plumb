public static class FunctionResultExtensions
{
    // An Azure Functions bridge: named like neither adapter, returning the worker's HTTP response.
    public static async Task<HttpResponseData> ToResponse(this RivetResult result, HttpRequestData request)
    {
        var response = request.CreateResponse();
        await response.WriteAsJsonAsync(result);
        return response;
    }

    // Named like the adapter, returning something else.
    public static object ToResult(this RivetResult<Order> result) => result;
}
