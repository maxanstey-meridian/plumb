namespace App.Modules.Orders;

// A local bound to a constructed RivetActionResult.
public sealed class ConstructedAdapter
{
    public IResult Send(object body)
    {
        var made = new RivetActionResult(200, body);
        return Results.Json(made.Value);
    }
}
