public static class TypedResultExtensions
{
    public static Task<Results<Ok, NotFound>> ToResult(this RivetResult result) => Task.FromResult<Results<Ok, NotFound>>(TypedResults.Ok());
}
