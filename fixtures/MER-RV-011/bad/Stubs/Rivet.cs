global using Rivet;

namespace Rivet;

[AttributeUsage(AttributeTargets.Class)]
public sealed class RivetContractAttribute : Attribute;

public sealed class RouteDefinition<TResponse>(string route)
{
    public string Route { get; } = route;

    public RouteDefinition<TResponse> Returns<TError>(int statusCode) => this;
}

public sealed class RouteDefinition<TRequest, TResponse>(string route)
{
    public string Route { get; } = route;

    public RouteDefinition<TRequest, TResponse> Returns<TError>(int statusCode) => this;
}

public static class Define
{
    public static RouteDefinition<TResponse> Get<TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Post<TRequest, TResponse>(string route) => new(route);
}
