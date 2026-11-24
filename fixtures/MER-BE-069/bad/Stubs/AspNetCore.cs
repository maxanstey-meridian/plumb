// Stand-ins for the ASP.NET Core packages, in their real namespaces: the rules judge a type by its full name.
namespace Microsoft.AspNetCore.Authorization
{
    [AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
    public sealed class AuthorizeAttribute : Attribute
    {
        public string? Policy { get; set; }
    }
}

namespace Microsoft.AspNetCore.Mvc
{
    public interface IActionResult { }

    public sealed class OkResult : IActionResult { }

    public sealed class ForbidResult : IActionResult { }

    public abstract class ControllerBase
    {
        public System.Security.Claims.ClaimsPrincipal User { get; } = new();

        protected OkResult Ok() => new();

        protected ForbidResult Forbid() => new();
    }
}

namespace Microsoft.AspNetCore.Http
{
    public interface IResult { }

    file sealed class SimpleResult : IResult { }

    public static class Results
    {
        public static IResult Ok() => new SimpleResult();

        public static IResult Forbid() => new SimpleResult();
    }
}

namespace Microsoft.AspNetCore.Routing
{
    public interface IEndpointRouteBuilder { }
}

namespace Microsoft.AspNetCore.Builder
{
    public interface IEndpointConventionBuilder { }

    public sealed class RouteGroupBuilder : Microsoft.AspNetCore.Routing.IEndpointRouteBuilder, IEndpointConventionBuilder { }

    public sealed class RouteHandlerBuilder : IEndpointConventionBuilder { }

    public static class EndpointRouteBuilderExtensions
    {
        public static RouteGroupBuilder MapGroup(this Microsoft.AspNetCore.Routing.IEndpointRouteBuilder endpoints, string prefix) => new();

        public static RouteHandlerBuilder MapPost(this Microsoft.AspNetCore.Routing.IEndpointRouteBuilder endpoints, string pattern, Delegate handler) => new();
    }

    public static class AuthorizationEndpointConventionBuilderExtensions
    {
        public static TBuilder RequireAuthorization<TBuilder>(this TBuilder builder, params string[] policyNames)
            where TBuilder : IEndpointConventionBuilder => builder;
    }
}

namespace App.Stubs
{
    public enum UserRole
    {
        Viewer,
        Editor,
        Admin,
    }

    public interface IUserContext
    {
        UserRole Role { get; }
    }

    public static class AreaAccess
    {
        public static bool Allows(UserRole role) => role >= UserRole.Editor;
    }
}
