public sealed class CreateXUseCase
{
    public async Task<Result> ExecuteAsync(Command command, CancellationToken cancellationToken) => new();
}
