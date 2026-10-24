namespace Audit;

// Another project's own Adapted: App's global alias doesn't reach it.
public sealed record Adapted(object? Value, int StatusCode);

public static class AdaptedEndpoints
{
    public static IResult Show(Adapted adapted) => Results.Ok(adapted.Value);
}
