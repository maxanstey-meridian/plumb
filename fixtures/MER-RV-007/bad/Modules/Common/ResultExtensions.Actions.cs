public static partial class ResultExtensions
{
    public static IActionResult ToActionResult<T>(this RivetResult<T> result) => new OkResult();
}
