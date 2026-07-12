var app = builder.Build();
var api = app.MapGroup("/api");
app.MapOrdersEndpoints();
app.MapGet(
    "/health/ready",
    () => Results.Ok());
app.MapGet(
    "/api/health/live",
    () => Results.Ok());
app.MapGet(
    "/",
    () => "ok");
app.MapOrdersEndpoints();
