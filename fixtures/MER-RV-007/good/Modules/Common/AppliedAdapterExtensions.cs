namespace App.Modules.Common;

// A helper that sets a result filter's context.Result to Rivet's adapter output lets Rivet write the response,
public static class AppliedAdapterExtensions
{
    public static IActionResult ApplyTo(this RivetResult r, ResultExecutingContext context) => context.Result = r.ToActionResult();
}

// and one that sets an audit context's own Result, even to the adapter's status, before returning the adapter's
// output writes no response: an app's audit context is not a filter's.
public static class AuditedAdapterExtensions
{
    public static IActionResult Audited(this RivetResult r, AuditContext auditContext)
    {
        auditContext.Result = "seen";
        return r.ToActionResult();
    }

    public static IActionResult Recorded(this RivetResult r, AuditContext auditContext)
    {
        var adapted = r.ToActionResult();
        auditContext.Result = ((RivetActionResult)adapted).StatusCode;
        return adapted;
    }
}
