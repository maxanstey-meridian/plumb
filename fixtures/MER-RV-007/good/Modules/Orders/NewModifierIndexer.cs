namespace App.Modules.Orders;

public class StatusTable
{
    public int this[IActionResult r] => 0;
}

// The `new` modifier constructs nothing: the indexer's accessor block ends it, so its `a` stays its own and Show's
// own `a` is an Order.
public sealed class NewModifierIndexer : StatusTable
{
    public new int this[IActionResult r] { get { return r is RivetActionResult a ? a.StatusCode : 0; } }

    public IResult Show(Order a) => Results.Ok(a.Value);
}
