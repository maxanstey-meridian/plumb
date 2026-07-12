namespace App.Modules.Orders.Application;

public sealed class CreateOrder(IServiceProvider? services)
{
    public object Execute() => services.GetRequiredService<IOrderRepository>();
}

public sealed class RetryOrder(System.IServiceProvider? services);

public sealed class CancelOrder
{
    private readonly global::System.IServiceProvider? services;
}
