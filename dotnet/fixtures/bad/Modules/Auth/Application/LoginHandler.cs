using Modules.Auth.Infrastructure;     // MERBE002 — Application touching Infrastructure

namespace Modules.Auth.Application;

public sealed class LoginHandler
{
    public string Handle(string email) => email;
}
