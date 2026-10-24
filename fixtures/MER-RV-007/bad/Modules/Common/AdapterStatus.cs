public static class AdapterStatus
{
    // Not an extension and returns no HTTP result, still a bridge: it reads the adapter's output to rebuild it.
    public static int Of(IActionResult adapted) => ((RivetActionResult)adapted).StatusCode ?? 500;
}
