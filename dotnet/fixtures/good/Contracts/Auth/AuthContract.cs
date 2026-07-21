namespace Contracts.Auth;

[RivetContract]
public static class AuthContract
{
    public static readonly RouteDefinition<LoginRequest, LoginResponse> Login =
        Define.Post<LoginRequest, LoginResponse>("/api/auth/login").Returns<ErrorResponse>(422);
}

public sealed record LoginRequest(string Email);
public sealed record LoginResponse(string Name);
public sealed record ErrorResponse(string Code);
