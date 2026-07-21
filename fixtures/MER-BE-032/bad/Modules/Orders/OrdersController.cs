namespace App.Modules.Orders;
public sealed class OrdersController(OrderLinesController lines) : ControllerBase
{
    public string Get() => OrderLinesController.Map(lines);
}
public abstract class ControllerBase { }
