namespace App.Modules.Orders;

// A call reaches the overload its arguments pick: Status(order) is the Order one, which returns no read.
public sealed class OverloadedStatus(ILogger<OverloadedStatus> logger)
{
    private static int Status(RivetActionResult adapted) => adapted.StatusCode;

    private static int Status(Order order, int fallback) => fallback;

    public IResult Send(RivetActionResult adapted, Order order)
    {
        logger.LogInformation("adapted {Status}", Status(adapted));
        return Results.StatusCode(Status(order, 200));
    }
}
