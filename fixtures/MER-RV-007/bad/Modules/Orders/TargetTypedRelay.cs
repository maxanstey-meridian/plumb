namespace App.Modules.Orders;

// A target-typed `new(…)` declared as an ObjectResult builds one.
public sealed class TargetTypedLocal
{
    public IActionResult Send(RivetActionResult adapted)
    {
        ObjectResult result = new(adapted.Value) { StatusCode = adapted.StatusCode };
        return result;
    }
}

// The same, returned from a method declared to return an ObjectResult.
public sealed class TargetTypedReturn
{
    public ObjectResult Send(RivetActionResult adapted)
    {
        return new(adapted.Value);
    }
}
