namespace Rivet;

public sealed record RivetResult(int StatusCode = 200, object? Value = null);

public sealed class RivetActionResult(RivetResult result) : IActionResult
{
    public int StatusCode { get; } = result.StatusCode;

    public object? Value { get; } = result.Value;

    public Task ExecuteResultAsync(ActionContext context) => Task.CompletedTask;
}
