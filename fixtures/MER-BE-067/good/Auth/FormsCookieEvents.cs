using App.Modules.Forms.Application.CreateForm;
using Microsoft.AspNetCore.Authentication.Cookies;

namespace App.Auth;

public sealed class FormsCookieEvents(CreateFormUseCase createForm) : CookieAuthenticationEvents
{
    public Task<bool> Validate(string title, CancellationToken cancellationToken) => createForm.ExecuteAsync(title, cancellationToken);
}
