namespace App.Modules.Billing;

// The app's own type named like Rivet's adapter output, in a namespace the Orders code is not in.
public sealed record RivetActionResult(int StatusCode, object? Value);
