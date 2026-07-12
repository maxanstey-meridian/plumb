namespace App.Modules.Orders.Application;

public sealed class CreateOrder(IOrderRepository repository)
{
    public object Execute() => repository.Create();
}

public interface IApplicationServiceProvider { }

public sealed class ServiceLookup(IApplicationServiceProvider provider, ServiceCatalog catalog)
{
    public object Execute() => catalog.GetService("orders");
    public string Example => "System.IServiceProvider is only documentation here";
    public string GlobalExample => @"global::System.IServiceProvider services
is still documentation";
}

// public sealed class CommentedOut(System.IServiceProvider services) { }
/*
public sealed class BlockCommentedOut(global::System.IServiceProvider services) { }
*/
