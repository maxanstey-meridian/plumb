using App.Modules.Forms.Infrastructure;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace App.Auth;

public sealed class FormsCookieEvents(FormStore store) : CookieAuthenticationEvents
{
    public Task<bool> Exists(string title, CancellationToken cancellationToken) => store.ExistsAsync(title, cancellationToken);
}
