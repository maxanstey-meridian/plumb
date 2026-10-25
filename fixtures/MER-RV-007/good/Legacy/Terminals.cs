namespace Legacy;

// A project App doesn't reference, whose types App's aliases below name.
public sealed record Adapted(int StatusCode, object? Value);

public sealed record Terminal(int StatusCode);
