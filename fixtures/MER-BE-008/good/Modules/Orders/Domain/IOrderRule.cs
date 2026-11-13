namespace App.Modules.Orders.Domain;

// A policy the Application fills in: nothing in Infrastructure implements it, so it is no port.
public interface IOrderRule
{
    bool Allows(string order);
}
