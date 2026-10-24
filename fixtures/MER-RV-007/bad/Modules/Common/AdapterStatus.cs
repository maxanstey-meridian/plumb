public static class AdapterStatus
{
    // Not an extension, still a bridge: it copies the adapter's output into a result of its own.
    public static IActionResult Copy(IActionResult adapted)
    {
        var a = (RivetActionResult)adapted;
        return new ObjectResult(a.Value) { StatusCode = a.StatusCode };
    }
}
