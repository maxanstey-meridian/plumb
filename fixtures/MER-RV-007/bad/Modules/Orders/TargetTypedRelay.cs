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

// The same, from an async method declared to return a Task of one.
public sealed class TargetTypedAsync
{
    public async Task<ObjectResult> SendAsync(RivetActionResult adapted)
    {
        await Task.Yield();
        return new(adapted.Value);
    }
}

// The same, from a method declared to return a global::-qualified one.
public sealed class TargetTypedGlobal
{
    public global::Microsoft.AspNetCore.Mvc.ObjectResult Send(RivetActionResult adapted) => new(adapted.Value);
}
