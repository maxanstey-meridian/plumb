public static partial class ResultExtensions
{
    public static IResult ToResult(this RivetResult result) => Results.Ok();
    public static IResult ToResult<T>(this RivetResult<T> result) => Results.Ok();
    public static IActionResult ToActionResult(this RivetResult result) => new OkResult();
}

public static class UnrelatedResultExtensions
{
    public static IResult ToResult(this ValidationResult result) => Results.Ok();
}
