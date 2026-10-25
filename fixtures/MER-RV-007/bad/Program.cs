var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/", () => OrdersContract.List.Success(new OrderPage()).ToActionResult() is Rivet.RivetActionResult adapted ? Results.Json(adapted.Value) : Results.Ok());
app.MapGet("/status", (IActionResult result) => Results.StatusCode(Status(result)));
app.MapGet("/sibling", (IActionResult result) => Results.StatusCode(TopLevelReads.Status((Rivet.RivetActionResult)result)));
app.MapGet("/instance", (IActionResult result) => Results.StatusCode(new InstanceReads().Status((Rivet.RivetActionResult)result)));
app.Run();

static int Status(IActionResult result) => result is Rivet.RivetActionResult shown ? shown.StatusCode : 200;

static class TopLevelReads
{
    public static int Status(Rivet.RivetActionResult adapted) => adapted.StatusCode;
}

sealed class InstanceReads
{
    public int Status(Rivet.RivetActionResult adapted) => adapted.StatusCode;
}
