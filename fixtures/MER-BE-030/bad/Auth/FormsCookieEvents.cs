using Microsoft.AspNetCore.Authentication.Cookies;

namespace App.Auth;

public sealed class FormsCookieEvents(Microsoft.EntityFrameworkCore.DbContext db) : CookieAuthenticationEvents
{
    public bool Ready() => db is not null;
}
