using Rivet;

namespace App.Modules.Orders;

// A qualified namesake written in a body says nothing about the bare name, which is still Rivet's.
public static class Namesakes
{
    public sealed record RivetActionResult(int StatusCode, object? Value);
}

public sealed class MixedQualifiers
{
    IResult Send(Namesakes.RivetActionResult legacy, RivetActionResult adapted) =>
        Results.Json(adapted.Value, statusCode: legacy.StatusCode);
}
