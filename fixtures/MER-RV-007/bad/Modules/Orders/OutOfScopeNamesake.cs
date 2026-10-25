using Rivet;

namespace App.Modules.Orders;

// Billing's own RivetActionResult is not in scope here, nor are Tools' global-namespace namesakes (Tools is a project
// App doesn't reference): the bare names are Rivet's, so building a result from the adapter's output copies it,
public sealed class OutOfScopeNamesake
{
    IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value);
}

// and an extension off RivetResult returning an HTTP result is a bridge.
public static class OutOfScopeBridge
{
    public static IResult ToHttp(this RivetResult r) => Results.Json(r);
}
