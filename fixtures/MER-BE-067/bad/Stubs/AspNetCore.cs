// Stand-ins for the ASP.NET Core packages, in their real namespaces: the rules judge a type by its full name.
namespace Microsoft.AspNetCore.Mvc
{
    public abstract class ControllerBase { }
}

namespace Microsoft.AspNetCore.Authentication.Cookies
{
    public class CookieAuthenticationEvents
    {
        public Func<string, Task<bool>> OnSigningIn { get; set; } = _ => Task.FromResult(true);
    }
}

namespace Microsoft.AspNetCore.Routing
{
    public interface IEndpointRouteBuilder { }
}

namespace Microsoft.AspNetCore.Builder
{
    public static class EndpointRouteBuilderExtensions
    {
        public static void MapGet(this Microsoft.AspNetCore.Routing.IEndpointRouteBuilder endpoints, string pattern, Delegate handler) { }
    }
}
