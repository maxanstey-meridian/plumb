namespace App.Modules.Orders;

public sealed record Order(object? Value);

// A pattern's `{ }` doesn't end Check, so its `a` stays Check's: Show's own `a` is an Order.
public sealed class PatternCheck
{
    public bool Check(IActionResult r) => r is Order { } && r is RivetActionResult a && a.StatusCode == 200;

    public IResult Show(Order a) => Results.Ok(a.Value);
}
