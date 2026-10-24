namespace Rivet;

// Rivet's own first-party adapters: the one place these conversions belong.
public static class RivetResultExtensions
{
    public static IResult ToResult(this RivetResult result) => Results.Ok();
    public static IActionResult ToActionResult(this RivetResult result) => new OkResult();
}
