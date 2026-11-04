using RivetActionResult = Vendor.Http.Adapted;
using RivetResult = Vendor.Http.Terminal;

namespace App.Modules.Orders;

// Nor are aliases of those names bound to types declared in source (Stubs/Vendor.cs), in a namespace that isn't
// Rivet's. The aliases bound to types outside the source are OutsideAliasedNamesakes.cs and OutsideAliasedTerminal.cs.
public sealed class VendorAliasedNamesake
{
    IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value);
}

public static class VendorAliasedTerminalExtensions
{
    public static IResult ToHttp(this RivetResult r) => Results.Json(r);
}
