// A file's own alias reaches only the namespace block it's written in.
namespace App.Modules.Common.Reading
{
    using Wrapped = Rivet.RivetActionResult;

    public sealed class StatusReader(ILogger<StatusReader> logger)
    {
        public void Log(IActionResult result)
        {
            if (result is Wrapped adapted) logger.LogInformation("responding {Status}", adapted.StatusCode);
        }
    }
}

namespace App.Modules.Common.Paging
{
    public sealed record Wrapped(object? Value);

    public static class PageEndpoint
    {
        public static IResult Send(Wrapped page) => Results.Ok(page.Value);
    }
}
