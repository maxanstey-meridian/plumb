namespace App.Modules.Common;

public static class Plain
{
    public static string Name => "plain";
}

// The adapter's output in a record's parameter list belongs to the record, not to the class before it.
public record Wrapper(RivetActionResult Inner)
{
    public IActionResult Copy() => new ObjectResult(Inner.Value) { StatusCode = Inner.StatusCode };
}
