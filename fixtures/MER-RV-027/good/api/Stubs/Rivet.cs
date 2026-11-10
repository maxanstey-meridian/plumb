namespace Rivet;

[AttributeUsage(AttributeTargets.Class)]
public sealed class RivetContractAttribute : Attribute;

[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter)]
public sealed class RivetOptionalAttribute : Attribute;

public sealed class RouteDefinition<TResponse>(string route)
{
    public string Route { get; } = route;

    public RouteDefinition<TResponse> Returns<TError>(int statusCode, string? description = null) => this;
}

public sealed class RouteDefinition<TRequest, TResponse>(string route)
{
    public string Route { get; } = route;

    public RouteDefinition<TRequest, TResponse> Returns<TError>(int statusCode, string? description = null) => this;
}

public static class Define
{
    public static RouteDefinition<TResponse> Get<TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Post<TRequest, TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Put<TRequest, TResponse>(string route) => new(route);
}
