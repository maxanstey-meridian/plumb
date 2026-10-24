namespace App.Modules.Orders;

// A property of the same type that returns a read hands it to its callers.
public sealed class PropertyHelper(RivetActionResult adapted)
{
    private int Status => adapted.StatusCode;

    public IResult Send() => Results.StatusCode(Status);
}

// The same, through an auto-property's initializer, read in a ?: arm.
public sealed class InitializedProperty(RivetActionResult adapted)
{
    private int Status { get; } = adapted.StatusCode;

    public IResult Send(bool ok) => Results.StatusCode(ok ? Status : 500);
}
