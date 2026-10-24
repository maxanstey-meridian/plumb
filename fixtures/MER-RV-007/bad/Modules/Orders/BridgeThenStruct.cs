public static class StructBridgeExtensions
{
    public static IResult ToHttp(this RivetResult result) => Results.Json(result);
}

// A struct after a bridge class is not part of it.
public readonly struct Relay
{
    public IActionResult Copy(IActionResult adapted) => adapted is RivetActionResult a ? new ObjectResult(a.Value) : adapted;
}
