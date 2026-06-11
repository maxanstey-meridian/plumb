using Modules.Auth.Domain;             // own Domain from Application — allowed direction

namespace Modules.Auth.Application;

public sealed class LoginHandler
{
    public User Handle(string email) => new("id", email);
}
