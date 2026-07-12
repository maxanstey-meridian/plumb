namespace Modules.Auth.Domain;

public sealed class FrameworkDependencies(
    global::OpenTelemetry.Trace.TracerProvider tracer,
    global::FluentResults.Result result) { }
