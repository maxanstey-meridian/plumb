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

// after global:: and its whole namespace,
public sealed class GlobalSiblingReader
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(global::App.Modules.Orders.StatusReader.Status(adapted));
}

public sealed class InstanceStatusReader
{
    public int Status(RivetActionResult adapted) => adapted.StatusCode;
}

// through an instance it constructs,
public sealed class SiblingInstanceReader
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(new InstanceStatusReader().Status(adapted));
}

// one it's handed,
public sealed class InjectedSiblingReader(InstanceStatusReader reader)
{
    public IResult Send(RivetActionResult adapted) => Results.StatusCode(reader.Status(adapted));
}

// or in a ?:'s arm, after its `:`.
public sealed class ConditionalSiblingReader
{
    public IResult Send(RivetActionResult adapted, bool flag) => Results.StatusCode(flag ? 200 : StatusReader.Status(adapted));
}
