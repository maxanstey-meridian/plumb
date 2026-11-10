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

// The same, returned from a conversion operator to an ObjectResult: the operator's type is its target.
public sealed record AdaptedEnvelope(RivetActionResult Adapted)
{
    public static implicit operator ObjectResult(AdaptedEnvelope e)
    {
        RivetActionResult a = e.Adapted;
        return new(a.Value) { StatusCode = a.StatusCode };
    }
}

// The same, to a global::-qualified ObjectResult: the qualifier is part of the operator's type.
public sealed record QualifiedAdaptedEnvelope(RivetActionResult Adapted)
{
    public static implicit operator global::Microsoft.AspNetCore.Mvc.ObjectResult(QualifiedAdaptedEnvelope e)
    {
        RivetActionResult a = e.Adapted;
        return new(a.Value) { StatusCode = a.StatusCode };
    }
}
