namespace App.Modules.Common.Shim;

// An app's own vendored copy of the adapter type. The compiler lists no use of a type's name inside its own
// declaration, so nothing marks the bare name here as the app's: the name is the app's when the type being judged
// is itself called that, at its own arity (this one is not generic, so the name written with type arguments is not hidden by it).
public sealed record RivetActionResult(int StatusCode, object? Value)
{
    public static implicit operator ObjectResult(RivetActionResult r) => new ObjectResult(r.Value) { StatusCode = r.StatusCode };
}
