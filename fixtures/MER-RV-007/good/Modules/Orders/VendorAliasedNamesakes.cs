using RivetActionResult = Vendor.Http.Adapted;
using RivetResult = Vendor.Http.Terminal;

namespace App.Modules.Orders;

// Nor are aliases of those names bound to a type outside the scan, in a namespace that isn't Rivet's.
public sealed class VendorAliasedNamesake
{
    IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value);
}

public static class VendorAliasedTerminalExtensions
{
    public static IResult ToHttp(this RivetResult r) => Results.Json(r);
}
