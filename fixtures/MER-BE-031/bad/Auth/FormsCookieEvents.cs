using Microsoft.AspNetCore.Authentication.Cookies;

namespace App.Auth;

public sealed class FormsCookieEvents : CookieAuthenticationEvents
{
    public Npgsql.NpgsqlConnection? Connection { get; set; }
}
