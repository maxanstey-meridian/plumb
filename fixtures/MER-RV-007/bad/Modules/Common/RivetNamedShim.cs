// Only Rivet's own namespace is Rivet's: a namespace under its name in the app's tree is the app's code.
namespace Rivet.Shims;

public static class Adapted
{
    public static IActionResult Copy(IActionResult adapted) => new ObjectResult(((RivetActionResult)adapted).Value);
}
