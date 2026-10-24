namespace App.Modules.Common.Outer
{
    using Wrapped = Rivet.RivetActionResult;

    // A namespace block's alias reaches its own types.
    public static class OuterCopy
    {
        public static IActionResult Copy(IActionResult r) => r is Wrapped a ? new ObjectResult(a.Value) : r;
    }

    namespace Inner
    {
        // And the types of a namespace nested in it.
        public static class InnerCopy
        {
            public static IResult Copy(IActionResult r) => r is Wrapped a ? Results.StatusCode(a.StatusCode) : Results.Ok();
        }
    }
}
