using App.Modules.Forms.Application.CreateForm;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;

namespace App.Host;

public static class Routes
{
    public static void Map(IEndpointRouteBuilder app, CookieAuthenticationEvents events, IServiceProvider services)
    {
        app.MapGet("/forms/create", (CreateFormUseCase createForm, CancellationToken cancellationToken) => createForm.ExecuteAsync("title", cancellationToken));
        events.OnSigningIn = title => ((CreateFormUseCase)services.GetService(typeof(CreateFormUseCase))!).ExecuteAsync(title, CancellationToken.None);
    }
}
