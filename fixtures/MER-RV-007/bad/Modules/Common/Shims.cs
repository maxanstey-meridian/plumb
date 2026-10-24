namespace Rivet.Shims
{
    public static class Adapted
    {
        public static IActionResult Copy(IActionResult adapted) => new ObjectResult(((RivetActionResult)adapted).Value);
    }
}

// A Rivet namespace earlier in the file does not make the app's code after it Rivet's.
namespace App.Modules
{
    public static class Leak
    {
        public static IActionResult Copy(IActionResult adapted) => new ObjectResult(((RivetActionResult)adapted).Value);
    }
}
