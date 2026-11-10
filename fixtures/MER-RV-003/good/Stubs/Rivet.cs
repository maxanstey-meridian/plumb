namespace Rivet;

[AttributeUsage(AttributeTargets.Class)]
public sealed class RivetContractAttribute : Attribute;

public sealed record RivetResult(int StatusCode = 200, object? Value = null)
{
    public IActionResult ToActionResult() => new ObjectResult(Value) { StatusCode = StatusCode };

    public IResult ToResult() => Results.Json(Value, statusCode: StatusCode);
}

public sealed class BoundRoute<TResponse>
{
    public RivetResult Success(TResponse response) => new(200, response);
}

public sealed class BoundInputRoute
{
    public RivetResult Success() => new(204);
}

public sealed class RouteDefinition<TResponse>(string route)
{
    public string Route { get; } = route;

    public RivetResult Success(TResponse response) => new(200, response);
}

public sealed class RouteDefinition<TRequest, TResponse>(string route)
{
    public string Route { get; } = route;

    public BoundRoute<TResponse> Bind(TRequest request) => new();
}

public sealed class InputRouteDefinition<TRequest>(string route)
{
    public string Route { get; } = route;

    public BoundInputRoute Bind(TRequest request) => new();
}

public sealed class PendingRoute(string route)
{
    public InputRouteDefinition<TRequest> Accepts<TRequest>() => new(route);
}

public static class Define
{
    public static RouteDefinition<TResponse> Get<TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Post<TRequest, TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Put<TRequest, TResponse>(string route) => new(route);

    public static PendingRoute Post(string route) => new(route);
}
