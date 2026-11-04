namespace App.Modules.Common.Shim;

// An app's own vendored copy of the adapter type. The compiler lists no use of a type's name inside its own
// declaration, so nothing marks the bare name here as the app's: the name is Rivet's only if no type of the file
// is called that.
public sealed record RivetActionResult(int StatusCode, object? Value)
{
    public static implicit operator ObjectResult(RivetActionResult r) => new ObjectResult(r.Value) { StatusCode = r.StatusCode };
}
