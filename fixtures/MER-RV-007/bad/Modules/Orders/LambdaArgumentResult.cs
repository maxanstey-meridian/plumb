namespace App.Modules.Orders;

// A result built around a lambda's block still copies the read after it, as an expression body
public sealed class LambdaArgumentJson
{
    public IResult Send(RivetActionResult adapted, List<int> items) => Results.Json(items.Select(i => { return i; }), statusCode: adapted.StatusCode);
}

// or after `return`.
public sealed class LambdaArgumentReturn
{
    public IResult Send(RivetActionResult adapted, List<int> items)
    {
        return Results.Json(items.Select(i => { return i; }), statusCode: adapted.StatusCode);
    }
}
