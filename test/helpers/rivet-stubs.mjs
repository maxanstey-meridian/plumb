// The Rivet declarations a temp repo's contracts name, so a project that uses them compiles: a project that doesn't compile
// gives the rules no facts. They sit in Rivet's own namespace, as the package declares them, and `global using Rivet;`
// brings them in the way the package's own props do. A repo spreads `...rivetStubs("api")` into its `files`, with `dir`
// the project folder: stubs under `Stubs/` reach only the project that compiles them, and the default SDK globbing
// compiles them there.
const rivetStubSource = `global using Rivet;

namespace Rivet;

[AttributeUsage(AttributeTargets.Class)]
public sealed class RivetContractAttribute : Attribute;

[AttributeUsage(AttributeTargets.All)]
public sealed class RivetOptionalAttribute : Attribute;

public sealed class RouteDefinition(string route)
{
    public string Route { get; } = route;

    public RouteDefinition Returns<TError>(int statusCode, string? description = null) => this;
}

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
    public static RouteDefinition Get(string route) => new(route);

    public static RouteDefinition Delete(string route) => new(route);

    public static RouteDefinition<TResponse> Get<TResponse>(string route) => new(route);

    public static RouteDefinition<TResponse> Post<TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Post<TRequest, TResponse>(string route) => new(route);

    public static RouteDefinition<TRequest, TResponse> Put<TRequest, TResponse>(string route) => new(route);
}
`;

// The stub file for the project in `dir` (no `dir` for a project at the repo's root).
export const rivetStubs = (dir = "") => ({ [`${dir && `${dir}/`}Stubs/Rivet.cs`]: rivetStubSource });

// Newtonsoft.Json's null-handling setting, for a repo that names it beside System.Text.Json's.
const newtonsoftStubSource = `global using Newtonsoft.Json;

namespace Newtonsoft.Json
{
    public enum NullValueHandling
    {
        Include,
        Ignore,
    }

    public sealed class JsonSerializerSettings
    {
        public NullValueHandling NullValueHandling { get; set; }
    }
}
`;

export const newtonsoftStubs = (dir = "") => ({ [`${dir && `${dir}/`}Stubs/Newtonsoft.cs`]: newtonsoftStubSource });

// The terminal a handler answers a route's field through, for a repo whose controllers call `Field.Success(...)
// .ToActionResult()`. It is added beside the route definitions above as extensions, so those stay as they are. The
// project references ASP.NET Core (the Web SDK) for `IActionResult`.
const rivetResultStubSource = `using Microsoft.AspNetCore.Mvc;

namespace Rivet;

public sealed class RivetResult
{
    public IActionResult ToActionResult() => new OkResult();
}

public static class RouteDefinitionTerminals
{
    public static RivetResult Success<TResponse>(this RouteDefinition<TResponse> definition, object? value) => new();
}
`;

export const rivetResultStubs = (dir = "") => ({ [`${dir && `${dir}/`}Stubs/RivetResult.cs`]: rivetResultStubSource });
