namespace App.Modules.Orders;

public static class AdapterReader
{
    public static int Status(RivetActionResult adapted) => adapted.StatusCode;
}

public sealed class Legacy
{
    public static class AdapterReader
    {
        public static int Status(Order order) => 0;
    }
}

// Another type's AdapterReader, qualified through the type around it, is not the sibling that returns a read.
public sealed class QualifiedNamesake
{
    public IResult Send(Order order) => Results.StatusCode(Legacy.AdapterReader.Status(order));
}

public sealed class Gauge
{
    public int Status(Order order) => 0;
}

// Nor is a property named like it.
public sealed class PropertyNamesake(Gauge gauge)
{
    private Gauge AdapterReader => gauge;

    public IResult Send(Order order) => Results.StatusCode(this.AdapterReader.Status(order));
}
