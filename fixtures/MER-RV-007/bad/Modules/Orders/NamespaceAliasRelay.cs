using R = Rivet;

namespace App.Modules.Orders;

// The adapter's output under a file's alias of Rivet's namespace,
public sealed class NamespaceAliasRelay
{
    public IResult Send(R.RivetActionResult adapted) => Results.Json(adapted.Value);
}

// and a bridge off RivetResult qualified by it through `::`.
public static class NamespaceAliasExtensions
{
    public static IResult ToHttp(this R::RivetResult result) => Results.Json(result);
}
