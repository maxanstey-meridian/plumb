using Terminal = Rivet.RivetResult;
using GlobalTerminal = global::Rivet.RivetResult;
using OrderTerminal = Rivet.RivetResult<Order>;

namespace App.Modules.Common;

// A bridge off Rivet's RivetResult written under a file's alias of it,
public static class AliasedResultExtensions
{
    public static IResult ToHttp(this Terminal result) => Results.Json(result);
}

// a global::-qualified alias,
public static class GlobalAliasedResultExtensions
{
    public static IResult ToHttp(this GlobalTerminal result) => Results.Json(result);
}

// or an alias of a closed generic one.
public static class GenericAliasedResultExtensions
{
    public static IResult ToHttp(this OrderTerminal result) => Results.Json(result);
}
