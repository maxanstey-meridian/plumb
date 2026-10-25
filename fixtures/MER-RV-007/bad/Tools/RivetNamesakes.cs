// A project no other references declares global-namespace types named like Rivet's: code that doesn't compile
// against it still means Rivet's.
public sealed record RivetActionResult(int StatusCode, object? Value);

public sealed record RivetResult(int StatusCode);
