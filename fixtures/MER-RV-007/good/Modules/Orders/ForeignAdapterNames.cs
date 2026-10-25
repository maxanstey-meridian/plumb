using Foreign = App.Modules.Orders.Legacy.RivetActionResult;
using ForeignTerminal = App.Modules.Orders.Legacy.RivetResult;
using LegacyTypes = App.Modules.Orders.Legacy;

namespace App.Modules.Orders;

// The app's own types that happen to share Rivet's names.
public static class Legacy
{
    public sealed record RivetActionResult(int StatusCode, object? Value);

    public sealed record RivetResult(int Code);

    // Inside Legacy the bare name is Legacy's own RivetActionResult: a type declared around the code wins over
    // `using Rivet;`.
    public static IResult Send(RivetActionResult legacy) => Results.Json(legacy.Value);
}

// A RivetActionResult under another type's qualifier, under the global namespace's, or an alias of one, is not
// Rivet's adapter output: building a result from it copies nothing of Rivet's.
public sealed class QualifiedForeignName
{
    public IResult Send(Legacy.RivetActionResult legacy) => Results.Json(legacy.Value, statusCode: legacy.StatusCode);
}

public sealed class GlobalForeignName
{
    public IResult Send(global::RivetActionResult legacy) => Results.StatusCode(legacy.StatusCode);
}

public sealed class AliasedForeignName
{
    public IResult Send(Foreign legacy) => Results.Json(legacy.Value);
}

// Nor is one qualified by an alias of the type that declares it, which names no namespace of Rivet's.
public sealed class AliasQualifiedForeignName
{
    public IResult Send(LegacyTypes.RivetActionResult legacy) => Results.Json(legacy.Value);
}

// An extension off another type named RivetResult is no bridge off Rivet's.
public static class ForeignResultExtensions
{
    public static IResult ToHttp(this Legacy.RivetResult result) => Results.StatusCode(result.Code);
}

// Nor is one off an alias of it.
public static class AliasedForeignResultExtensions
{
    public static IResult ToHttp(this ForeignTerminal result) => Results.StatusCode(result.Code);
}
