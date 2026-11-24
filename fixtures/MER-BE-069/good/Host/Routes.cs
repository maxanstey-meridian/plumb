using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace App.Host;

public static class Routes
{
    public static void Map(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/areas");
        group.RequireAuthorization("Editors");

        group.MapPost("/rename", () => Results.Ok());
    }
}
