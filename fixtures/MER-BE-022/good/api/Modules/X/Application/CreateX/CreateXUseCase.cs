public sealed class CreateXUseCase
{
    private const string Example = "}";
    // } public Task<Result> ExecuteAsync(Command command) => new();
    /* { } */
    public async Task<Result> ExecuteAsync(Command command, CancellationToken cancellationToken) =>
        await dependency.ExecuteAsync(command, cancellationToken);
}
