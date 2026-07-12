public static class WorkerResultExtensions
{
    public static IResult ToResult<T>(this RivetResult<Page<Result<T>>> result) => Results.Ok();
}
