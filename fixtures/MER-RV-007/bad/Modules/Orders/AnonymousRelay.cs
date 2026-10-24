namespace App.Modules.Orders;

// An anonymous object's braces inside the arguments end no member.
public static class AnonymousRelay
{
    public static IResult Copy(IActionResult r) => r is RivetActionResult a ? Results.Json(new { ok = true }, statusCode: a.StatusCode) : Results.Ok();
}
