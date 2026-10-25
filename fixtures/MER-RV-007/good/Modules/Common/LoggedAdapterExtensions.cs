namespace App.Modules.Common;

// A helper that reads and logs the adapter's output, then returns the adapter, copies nothing: it is no bridge.
public static class LoggedAdapterExtensions
{
    public static IActionResult Logged(this RivetResult result, ILogger logger)
    {
        var adapted = (RivetActionResult)result.ToActionResult();
        logger.LogInformation("adapted {Status}", adapted.StatusCode);
        return result.ToActionResult();
    }
}
