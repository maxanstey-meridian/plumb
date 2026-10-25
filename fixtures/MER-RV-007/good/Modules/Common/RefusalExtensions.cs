namespace App.Modules.Common;

// A helper that owns an error path and returns Rivet's adapter output unchanged is not a bridge, arm by arm.
public static class RefusalExtensions
{
    public static IActionResult Done(this RivetResult result) => result.ToActionResult();

    public static async Task<IResult> Logged(this RivetResult result, ILogger logger)
    {
        await Task.Yield();
        logger.LogInformation("refused {Count}", Count(() => { return 1; }));
        int Local() { return 2; }
        T Pick<T>(T value) where T : class { return value; }
        return result.ToResult();
    }

    public static IResult Either(this RivetResult result, bool flag) => flag ? result.ToResult() : result.ToResult();

    public static IActionResult Checked(this RivetResult result) => result.ToActionResult() ?? throw new InvalidOperationException();

    public static IResult Switched(this RivetResult result, int kind)
    {
        return kind switch { 0 => result.ToResult(), _ => result.ToResult() };
    }

    public static IResult Matched(this RivetResult result, Outcome outcome) =>
        outcome.Match(ok => result.ToResult(), error: reason => result.ToResult());

    public static IResult TypedMatched(this RivetResult result, Outcome outcome) =>
        outcome.Match(IResult (ok) => result.ToResult(), error: IResult (reason) => result.ToResult());

    public static Task<IResult> MatchedAsync(this RivetResult result, Outcome outcome) =>
        outcome.MatchAsync(async ok => result.ToResult(), error: async reason => result.ToResult());

    public static IResult? NullableMatched(this RivetResult result, Outcome outcome) =>
        outcome.Match<IResult?>(ok => result.ToResult(), error: reason => result.ToResult());

    private static int Count(Func<int> count) => count();
}
