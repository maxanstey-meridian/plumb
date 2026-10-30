namespace App.Modules.Orders;

// A member's local function that returns a read hands it to the member's calls.
public sealed class MemberLocalStatus
{
    public IResult Send(RivetActionResult adapted)
    {
        int Status() => adapted.StatusCode;
        return Results.StatusCode(Status());
    }
}

// A call whose argument count picks the overload returning a read.
public sealed class PickedOverloadStatus
{
    private static int Status(RivetActionResult adapted) => adapted.StatusCode;

    private static int Status(Order order, int fallback) => fallback;

    public IResult Send(RivetActionResult adapted) => Results.StatusCode(Status(adapted));
}

// An interpolated string's alignment comma is not an argument: the call passes two and picks the overload that reads.
public sealed class AlignedOverloadStatus
{
    private static int Status(RivetActionResult adapted, string label) => adapted.StatusCode;

    private static int Status(Order order, int fallback, string label) => fallback;

    public IResult Send(RivetActionResult adapted, string name) => Results.StatusCode(Status(adapted, $"{name,-20}"));
}
