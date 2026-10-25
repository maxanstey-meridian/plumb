namespace Acme.Common;
// Only the host uses HostSettings; RetryWindow is named here, so the host consumes it too.
public sealed record HostSettings(RetryWindow Retry);
public sealed record RetryWindow(int Seconds);
