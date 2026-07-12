namespace Modules.Auth.Application;

public interface IServiceProvider { }

public sealed class CustomServiceLookup(IServiceProvider provider, ServiceCatalog catalog)
{
    public object Get() => catalog.GetService("auth");
}

public sealed class ServiceCatalog
{
    public object GetService(string name) => name;
}
