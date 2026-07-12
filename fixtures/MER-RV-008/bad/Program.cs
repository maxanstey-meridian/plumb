var app = builder.Build();
// app.MapOrdersEndpoints();
app.MapPost("/api/orders", async request => await Create(request));
app.MapGet(OrdersContract.List.Route, ListOrders);
app.MapPut(orderRoute, UpdateOrder);
