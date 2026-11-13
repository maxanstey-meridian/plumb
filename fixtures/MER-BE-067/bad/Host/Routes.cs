using App.Modules.Forms.Application.Ports;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace App.Host;

public static class Routes
{
    public static void Map(IEndpointRouteBuilder app, CookieAuthenticationEvents events, IServiceProvider services)
    {
        app.MapGet("/forms/exists", (IFormRepository forms, CancellationToken cancellationToken) => forms.ExistsAsync("title", cancellationToken));
        events.OnSigningIn = title => ((IFormRepository)services.GetService(typeof(IFormRepository))!).ExistsAsync(title, CancellationToken.None);
    }
}
