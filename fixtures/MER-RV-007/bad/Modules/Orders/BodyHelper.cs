namespace App.Modules.Orders;

// A block body's `return` of a read, then through a local.
public sealed class BodyHelper
{
    private static object? Body(IActionResult result)
    {
        if (result is RivetActionResult adapted) return adapted.Value;
        return null;
    }

    public IActionResult Send(IActionResult result)
    {
        var body = Body(result);
        return new ObjectResult(body);
    }
}
