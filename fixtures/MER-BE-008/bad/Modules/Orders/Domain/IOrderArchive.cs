namespace App.Modules.Orders.Domain;

// No repository by its name, and still a port: an Infrastructure adapter implements it.
public interface IOrderArchive
{
    bool Holds(string order);
}
