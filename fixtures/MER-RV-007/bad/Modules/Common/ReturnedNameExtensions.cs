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

// One a deconstruction writes again holds what it assigns,
public static class DeconstructExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult other)
    {
        var adapted = result.ToActionResult();
        (adapted, _) = (other, 1);
        return adapted;
    }
}

// brackets and calls in the deconstruction's target too.
public static class BracketDeconstructExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult other, int[] slots)
    {
        var adapted = result.ToActionResult();
        (adapted, slots[Index(0)]) = (other, 1);
        return adapted;
    }

    static int Index(int value) => value;
}

// A value that may be the other operand of a ??, held in a local or returned directly, may be anything.
public static class CoalesceLocalExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult? other)
    {
        var adapted = other ?? result.ToActionResult();
        return adapted;
    }
}

public static class CoalesceReturnExtensions
{
    public static IActionResult ToHttp(this RivetResult result, IActionResult? other) => other ?? result.ToActionResult();
}

// A returned field is no local of the method's: another member may write it between the adapter and the return.
public static class FieldNameExtensions
{
    static IActionResult adapted = null!;

    public static IActionResult ToHttp(this RivetResult result, IActionResult other)
    {
        adapted = result.ToActionResult();
        Swap(other);
        return adapted;
    }

    static void Swap(IActionResult other) => adapted = other;
}
