namespace App.Modules.Common;

// A helper that sets a result filter's context.Result to Rivet's adapter output, directly or through the local
// holding it, lets Rivet write the response,
public static class AppliedAdapterExtensions
{
    public static IActionResult ApplyTo(this RivetResult r, ResultExecutingContext context) => context.Result = r.ToActionResult();

    public static IActionResult ApplyLocal(this RivetResult r, ResultExecutingContext context)
    {
        var adapted = r.ToActionResult();
        context.Result = adapted;
        return adapted;
    }

    // A null-forgiving `!` on the adapter's output is still the adapter's output.
    public static IActionResult Forgiven(this RivetResult r)
    {
        var adapted = r.ToActionResult()!;
        return adapted!;
    }
}

// and one that sets an audit or a transaction context's own Result, even to the adapter's status, before returning
// the adapter's output writes no response: an app's audit or transaction context is not a filter's.
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

    public static IActionResult Committed(this RivetResult r, TransactionContext transactionContext)
    {
        transactionContext.Result = "committed";
        return r.ToActionResult();
    }
}
