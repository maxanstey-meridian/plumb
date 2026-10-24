namespace App.Modules.Orders;

public static class StatusReader
{
    public static int Status(RivetActionResult adapted) => adapted.StatusCode;
}

// A sibling type's static helper hands the adapter's status back.
public sealed class SiblingReader
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(StatusReader.Status(adapted));
}
