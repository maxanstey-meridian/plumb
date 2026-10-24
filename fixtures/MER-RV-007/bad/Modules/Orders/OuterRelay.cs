namespace App.Modules.Orders;

public sealed class OuterRelay
{
    private sealed class Inner { }

    // The outer class's method, after its nested class.
    public IActionResult Copy(IActionResult adapted)
    {
        var a = (RivetActionResult)adapted;
        return new ObjectResult(a.Value) { StatusCode = a.StatusCode };
    }
}
