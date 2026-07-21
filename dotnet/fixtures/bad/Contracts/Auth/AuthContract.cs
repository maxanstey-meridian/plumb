using Modules.Auth.Application;

namespace Contracts.Auth;

[RivetContract]
public static class AuthContract
{
    public static readonly RouteDefinition<LoginCommand, LoginResponse> Login =
        Define.Post<LoginCommand, LoginResponse>("/api/auth/login").Returns<ErrorResponse>(422);
}

public sealed record LoginResponse(string Name);
public sealed record ErrorResponse(string Code);
