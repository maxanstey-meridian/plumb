using RivetResult = Microsoft.AspNetCore.Http.IResult;

namespace App.Modules.Orders;

// Nor is an alias of that name bound to an outside type.
public static class OutsideAliasedTerminalExtensions
{
    public static IResult ToHttp(this RivetResult r) => Results.Json(r);
}
