namespace App.Modules.Orders;

// An attribute naming the adapter's output reads nothing, even on a controller that builds a result elsewhere.
[ProducesResponseType(typeof(RivetActionResult), 200)]
public sealed class OrdersController : ControllerBase
{
    public IActionResult List() => OrdersContract.List.Success(new OrderPage()).ToActionResult();

    public IActionResult Gone() => Problem();
}
