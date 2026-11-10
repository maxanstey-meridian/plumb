using RivetActionResult = Microsoft.AspNetCore.Mvc.ObjectResult;

namespace App.Modules.Orders;

// Nor is an alias of that name bound to a type outside the source, which the facts record only as an external use.
public sealed class OutsideAliasedNamesake
{
    IResult Send(RivetActionResult adapted) => Results.Json(adapted.Value, statusCode: adapted.StatusCode);
}
