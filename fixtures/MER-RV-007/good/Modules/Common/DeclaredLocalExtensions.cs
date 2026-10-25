namespace App.Modules.Common;

// A local the body declares holds the adapter's output however it's declared: on its own before its one write,
public static class DeferredLocalExtensions
{
    public static IActionResult ToResponse(this RivetResult r)
    {
        IActionResult adapted;
        adapted = r.ToActionResult();
        return adapted;
    }
}

// or as one of several declared in a statement, before or after the others.
public static class SeveralLocalsExtensions
{
    public static IActionResult ToResponse(this RivetResult r, IActionResult x)
    {
        IActionResult other = x, adapted = r.ToActionResult();
        return adapted;
    }

    public static IActionResult FirstOfSeveral(this RivetResult r, IActionResult x)
    {
        IActionResult adapted = r.ToActionResult(), other = x;
        return adapted;
    }
}
