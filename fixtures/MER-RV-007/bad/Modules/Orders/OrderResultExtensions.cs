public static class OrderResultExtensions
{
    public static IResult ToResult<T>(this RivetResult<Page<Result<T>>> result) => Results.Ok();
}
