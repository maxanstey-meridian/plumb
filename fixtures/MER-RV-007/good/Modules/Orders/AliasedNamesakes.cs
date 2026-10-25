using RivetActionResult = Legacy.Adapted;
using RivetResult = Legacy.Terminal;

namespace App.Modules.Orders;

// Aliases named like Rivet's types but bound to another project's: neither is Rivet's, referenced or not.
public sealed class AliasedNamesake
{
    IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value);
}

public static class AliasedTerminalExtensions
{
    public static IResult ToHttp(this RivetResult r) => Results.Json(r);
}
