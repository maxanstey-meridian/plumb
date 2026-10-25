namespace App.Modules.Common;

// A helper that adapts once, reads and logs the adapter's output, then returns what the adapter returned, copies
// nothing: it is no bridge.
public static class LoggedAdapterExtensions
{
    public static IActionResult Logged(this RivetResult result, ILogger logger)
    {
        var adapted = result.ToActionResult();
        logger.LogInformation("adapted {Status}", ((RivetActionResult)adapted).StatusCode);
        return adapted;
    }
}
