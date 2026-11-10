namespace Rivet;

public sealed record RivetResult(int StatusCode = 200, object? Value = null)
{
    public bool IsError => StatusCode >= 400;
}

public sealed record RivetResult<T>(int StatusCode = 200, T? Value = default)
{
    public bool IsError => StatusCode >= 400;

    public Task<T?> ValueAsync() => Task.FromResult(Value);
}

public sealed class RivetActionResult(int statusCode, object? value) : IActionResult
{
    public RivetActionResult(RivetResult result)
        : this(result.StatusCode, result.Value)
    {
    }

    public int StatusCode { get; } = statusCode;

    public object? Value { get; } = value;

    public Task ExecuteResultAsync(ActionContext context) => Task.CompletedTask;
}
