public static partial class ResultExtensions
{
    public static IResult ToResult(this RivetResult result) => Results.Ok();
    public static IActionResult ToActionResult(this RivetResult result) => new OkResult();
}
