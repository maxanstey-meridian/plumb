namespace App.Modules.Orders;

public static class StatusReader
{
    public static int Status(RivetActionResult adapted) => adapted.StatusCode;
}

// A sibling type's static helper hands the adapter's status back, named bare,
public sealed class SiblingReader
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(StatusReader.Status(adapted));
}

// after a suffix of its namespace,
public sealed class NamespacedSiblingReader
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(Orders.StatusReader.Status(adapted));
}

// or after global:: and its whole namespace.
public sealed class GlobalSiblingReader
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(global::App.Modules.Orders.StatusReader.Status(adapted));
}
