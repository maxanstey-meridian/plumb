using App.Stubs;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace App.Host;

public static class Routes
{
    public static void Map(IEndpointRouteBuilder app, bool authEnabled)
    {
        var group = app.MapGroup("/api/areas");
        if (authEnabled)
        {
            group.RequireAuthorization("Editors");
        }

        group.MapPost("/rename", (IUserContext userContext) =>
        {
            if (!AreaAccess.Allows(userContext.Role))
            {
                return Results.Forbid();
            }

            return Results.Ok();
        });
    }
}
