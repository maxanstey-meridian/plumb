var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/", () => OrdersContract.List.Success(new OrderPage()).ToActionResult() is Rivet.RivetActionResult adapted ? Results.Json(adapted.Value) : Results.Ok());
app.Run();
