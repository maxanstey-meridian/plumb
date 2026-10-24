namespace App.Modules.Orders;

// A field binds the adapter's output for every member.
public sealed class HeldRelay
{
    private readonly RivetActionResult held;

    public HeldRelay(RivetActionResult held) => this.held = held;

    public IActionResult Copy() => new ObjectResult(held.Value);
}
