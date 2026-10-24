namespace App.Modules.Orders;

// A struct is a type too: one finding for it, not one per line.
public readonly struct StatusCopy
{
    public static IActionResult Copy(IActionResult adapted)
    {
        var a = (RivetActionResult)adapted;
        return new ObjectResult(((RivetActionResult)adapted).Value) { StatusCode = a.StatusCode };
    }
}
