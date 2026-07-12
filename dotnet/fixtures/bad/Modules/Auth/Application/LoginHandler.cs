using Modules.Auth.Infrastructure;     // MERBE002 — Application touching Infrastructure
using Microsoft.AspNetCore.Http;       // MERBE002 — transport framework in Application
using Microsoft.Extensions.DependencyInjection;
using Provider = System.IServiceProvider;

namespace Modules.Auth.Application;

public sealed class LoginHandler(System.IServiceProvider services)
{
    public string Handle(string email) => services.GetRequiredService<string>(); // MERBE009
}

public sealed class AliasedLoginHandler(Provider? services)
{
    public object? Handle() => services;
}
