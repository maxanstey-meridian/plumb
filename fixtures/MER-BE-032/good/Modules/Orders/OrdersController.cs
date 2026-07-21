namespace App.Modules.Orders;
[ApiController]
public sealed class OrdersController(CreateOrderUseCase create) : ControllerBase
{
    public static string Map(string value) => value;
}
public sealed class CreateOrderUseCase { }
public abstract class ControllerBase { }
