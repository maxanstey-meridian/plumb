namespace Relay;

// The adapter's output under an alias its project's .csproj declares.
public static class WrappedRelay
{
    public static IResult Copy(IActionResult result) =>
        result is Wrapped wrapped ? Results.Json(wrapped.Value, statusCode: wrapped.StatusCode) : Results.NoContent();
}
