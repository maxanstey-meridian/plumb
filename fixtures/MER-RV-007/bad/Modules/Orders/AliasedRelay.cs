using Adapted = Rivet.RivetActionResult;

namespace App.Modules.Orders;

// The adapter's output under an alias; the alias line builds no result, so only the class is reported.
public static class AliasedRelay
{
    public static IActionResult Copy(IActionResult result) => result is Adapted adapted ? new ObjectResult(adapted.Value) : result;
}
