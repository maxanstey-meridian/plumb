namespace App.Modules.Orders;

// An attribute naming the adapter's output belongs to the class below it, which builds no result of its own.
[ProducesResponseType(typeof(RivetActionResult), 200)]
public sealed class OrdersController : ControllerBase
{
    public IActionResult List() => OrdersContract.List.Success(new OrderPage()).ToActionResult();
}
