namespace App.Modules.Orders;

public static class OrdersEndpoints
{
    // public static IResult ToResult(this RivetResult result) — a comment, not a bridge.
    public static IResult List() => OrdersContract.List.Success(new OrderPage()).ToResult();
}
