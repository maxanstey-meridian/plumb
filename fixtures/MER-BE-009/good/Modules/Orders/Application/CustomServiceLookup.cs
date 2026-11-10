namespace App.Modules.Orders.Application;

// The module's own interface, not System.IServiceProvider.
public interface IServiceProvider { }

public sealed class CustomServiceLookup(IServiceProvider provider, ServiceCatalog catalog)
{
    public object Get() => catalog.GetService("orders");
}
