namespace Modules.Auth.Application;

public sealed class FullyQualifiedDependency(
    global::Modules.Auth.Infrastructure.InfraService infrastructure,
    global::Microsoft.AspNetCore.Http.HttpContext context) { }
