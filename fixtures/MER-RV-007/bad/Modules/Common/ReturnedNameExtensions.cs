namespace App.Modules.Common;

// A returned local is the adapter's only where its one write assigns it: reassigned afterwards,
public static class ReassignedNameExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult other)
    {
        var adapted = result.ToActionResult();
        adapted = other;
        return adapted;
    }
}

// or assigned the adapter only in a lambda's block, whose local it is, it may be anything.
public static class LambdaNameExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult adapted)
    {
        Func<IActionResult> later = () => { var adapted = result.ToActionResult(); return adapted; };
        return adapted;
    }
}

// A local assigned the adapter on one arm of a ?: only may hold the other,
public static class BranchNameExtensions
{
    public static IActionResult ToHttp(this RivetResult result, bool flag, IActionResult other)
    {
        var adapted = flag ? other : result.ToActionResult();
        return adapted;
    }
}

// and one a deconstruction writes again holds what it assigns.
public static class DeconstructExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult other)
    {
        var adapted = result.ToActionResult();
        (adapted, _) = (other, 1);
        return adapted;
    }
}
