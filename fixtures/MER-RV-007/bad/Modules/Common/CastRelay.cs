namespace App.Modules.Common;

// Straight off a cast, in the statement that builds the result.
public static class CastRelay
{
    public static IResult Copy(IActionResult adapted) =>
        Results.Json(((RivetActionResult)adapted).Value, statusCode: ((RivetActionResult)adapted).StatusCode);
}
