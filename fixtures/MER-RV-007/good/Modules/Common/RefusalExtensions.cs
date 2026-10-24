namespace App.Modules.Common;

// A helper that owns an error path and goes through Rivet's adapter is not a bridge.
public static class RefusalExtensions
{
    public static IActionResult Done(this RivetResult result) => result.ToActionResult();

    public static IResult Logged(this RivetResult result, ILogger logger)
    {
        logger.LogInformation("refused");
        return result.ToResult();
    }
}
