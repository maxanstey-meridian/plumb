using Shown = Rivet.RivetActionResult;

var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/", () => OrdersContract.List.Success(new OrderPage()).ToActionResult() is Shown shown ? Results.Json(shown.Value) : Results.Ok());
app.Run();
