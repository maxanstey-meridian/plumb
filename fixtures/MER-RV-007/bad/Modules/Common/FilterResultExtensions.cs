namespace App.Modules.Common;

// Returning the adapter doesn't make a helper that sets a filter's result to something else any less of a bridge,
public static class OtherFilterResultExtensions
{
    public static IActionResult ApplyTo(this RivetResult r, ResultExecutingContext context, IActionResult other)
    {
        context.Result = other;
        return r.ToActionResult();
    }
}

// nor one that sets it to the adapter's output on one arm only.
public static class BranchFilterResultExtensions
{
    public static IActionResult ApplyTo(this RivetResult r, ResultExecutingContext context, bool flag, IActionResult other)
    {
        context.Result = flag ? r.ToActionResult() : other;
        return r.ToActionResult();
    }
}
