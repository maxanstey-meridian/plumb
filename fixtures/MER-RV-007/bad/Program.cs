var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/", () => OrdersContract.List.Success(new OrderPage()).ToActionResult() is Rivet.RivetActionResult adapted ? Results.Json(adapted.Value) : Results.Ok());
app.MapGet("/status", (IActionResult result) => Results.StatusCode(Status(result)));
app.Run();

static int Status(IActionResult result) => result is Rivet.RivetActionResult shown ? shown.StatusCode : 200;
