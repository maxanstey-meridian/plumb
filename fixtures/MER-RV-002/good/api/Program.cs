// §7 exception (speechscribe): bootstrap ops endpoints have no contract to come
// from; inline handlers in Program.cs are MER-RV-008's territory.
var app = Builder.Build();
app.MapGet("/api/health", () => Results.Ok());
app.MapGet("/", () => Results.Redirect("/app"));
app.Run();
