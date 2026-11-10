namespace App.Modules.Orders.Application;

public sealed class ServiceCatalog
{
    public object GetService(string name) => name;
}
