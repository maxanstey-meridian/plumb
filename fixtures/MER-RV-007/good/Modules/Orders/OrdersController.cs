namespace App.Modules.Orders;

// An attribute naming the adapter's output reads nothing, even on a controller that builds a result elsewhere, and
// constructing the app's own `Content` record is no controller helper.
[ProducesResponseType(typeof(RivetActionResult), 200)]
public sealed class OrdersController : ControllerBase
{
    public IActionResult List() => OrdersContract.List.Success(new OrderPage()).ToActionResult();

    public IActionResult Gone() => Problem();

    public IActionResult Logged(ILogger<OrdersController> logger)
    {
        var adapted = (RivetActionResult)OrdersContract.List.Success(new OrderPage()).ToActionResult();
        logger.LogDebug("{Body}", new Content(adapted.Value));
        return adapted;
    }
}
