namespace Host;

// A bridge off RivetResult under a `global using` alias of its project,
public static class HostTerminalExtensions
{
    public static IResult ToHttp(this HostTerminal result) => Results.Json(result);
}

// and the adapter's output under the project's `global using` alias of Rivet's namespace.
public static class NamespaceAliasedHostRelay
{
    public static IResult Copy(HostRivet.RivetActionResult adapted) => Results.Json(adapted.Value);
}
