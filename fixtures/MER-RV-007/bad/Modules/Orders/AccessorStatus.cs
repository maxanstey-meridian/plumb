namespace App.Modules.Orders;

// A property's `get =>` hands the adapter's status to its callers.
public sealed class AccessorStatus(RivetActionResult adapted)
{
    private int Status { get => adapted.StatusCode; }

    public IResult Send() => Results.StatusCode(Status);
}
