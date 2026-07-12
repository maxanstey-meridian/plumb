// Stub namespaces so the violating usings below compile — this file sits
// outside Modules/, so the analyzer ignores it by file-path convention.
namespace Modules.Billing.Domain
{
    internal static class BillingStub { }
    public sealed class BillingRecord { }
}
namespace Modules.Auth.Application { internal static class AppStub { } }
namespace Modules.Auth.Infrastructure
{
    internal static class InfraStub { }
    public sealed class InfraService { }
}
namespace Microsoft.EntityFrameworkCore { internal static class EfStub { } }
namespace Microsoft.AspNetCore.Http
{
    internal static class HttpStub { }
    public sealed class HttpContext { }
}
namespace Microsoft.Extensions.Logging { public interface ILogger { } }
namespace OpenTelemetry.Trace { public sealed class TracerProvider { } }
namespace FluentResults { public sealed class Result { } }
namespace Microsoft.Extensions.DependencyInjection
{
    public static class ServiceProviderServiceExtensions
    {
        public static T GetRequiredService<T>(this System.IServiceProvider services) => default!;
    }
}
