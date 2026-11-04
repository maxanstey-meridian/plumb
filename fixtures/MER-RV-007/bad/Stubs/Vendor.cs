namespace Vendor.Http;

public sealed record Adapted(object? Value, int StatusCode);

public sealed record Terminal(int StatusCode);
