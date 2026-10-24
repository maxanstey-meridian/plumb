namespace App.Modules.Orders;

// A member that returns a read hands it to its callers.
public sealed class StatusHelper(RivetActionResult adapted)
{
    private int Status() => adapted.StatusCode;

    public IResult Send() => Results.Json(null, statusCode: Status());
}
