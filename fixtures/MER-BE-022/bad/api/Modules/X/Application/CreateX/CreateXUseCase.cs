public sealed class CreateXUseCase
{
    private const string Example = "}";
    /* } */
    public async Task<Result> ExecuteAsync(Command command, RequestOptions<CancellationToken> options) => new();
    public async Task<Result> RetryAsync(Command command, CancellationToken cancellationToken) => new();
}

public sealed class DeleteXUseCase
{
    public Task<Result> DeleteAsync(Command command, CancellationToken cancellationToken) => new();
}
