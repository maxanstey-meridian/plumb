public static class HttpResultExtensions
{
    // Not named ToResult, still a bridge: it turns a RivetResult into an HTTP result.
    public static IResult ToHttpResult(this RivetResult r) => Results.Json(r);

    // A typed result behind a ValueTask, off the generic RivetResult.
    public static async ValueTask<Microsoft.AspNetCore.Http.HttpResults.Ok<T>> Respond<T>(this RivetResult<T> r) =>
        TypedResults.Ok(await r.ValueAsync());
}
