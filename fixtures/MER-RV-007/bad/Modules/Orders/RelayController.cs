namespace App.Modules.Orders;

// A controller's Ok(…) helper is a result of its own too.
public sealed class RelayController : ControllerBase
{
    public IActionResult List()
    {
        var a = (RivetActionResult)OrdersContract.List.Success(new OrderPage()).ToActionResult();
        return Ok(a.Value);
    }
}
