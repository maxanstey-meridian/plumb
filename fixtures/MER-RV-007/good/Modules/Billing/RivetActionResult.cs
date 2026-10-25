namespace App.Modules.Billing;

// The app's own type named like Rivet's adapter output, declared in its namespace.
public sealed record RivetActionResult(int StatusCode, object? Value);
