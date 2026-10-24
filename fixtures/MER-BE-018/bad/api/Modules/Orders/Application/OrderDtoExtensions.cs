namespace App.Contracts.Orders;

public static class OrderDtoExtensions
{
    public static bool IsDraft(this OrderDto order) => order.Reference.Length == 0;
}
