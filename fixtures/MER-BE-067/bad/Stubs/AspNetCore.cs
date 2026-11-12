// Stand-ins for the ASP.NET Core packages, in their real namespaces: the rules judge a type by its full name.
namespace Microsoft.AspNetCore.Mvc
{
    public abstract class ControllerBase { }
}

namespace Microsoft.AspNetCore.Authentication.Cookies
{
    public class CookieAuthenticationEvents { }
}
