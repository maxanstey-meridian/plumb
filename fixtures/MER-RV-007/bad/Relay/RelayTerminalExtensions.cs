namespace Relay;

// A bridge off RivetResult under an alias its project's .csproj declares,
public static class RelayTerminalExtensions
{
    public static IResult ToHttp(this RelayTerminal result) => Results.Json(result);
}

// and the adapter's output under the project's alias of Rivet's namespace.
public static class NamespaceAliasedRelay
{
    public static IResult Copy(RelayRivet.RivetActionResult adapted) => Results.Json(adapted.Value);
}
