namespace App.Modules.Auth.Application.GetUser;

// GOOD: the use case returns an application *Result; the edge maps it to the wire DTO.
public sealed class GetUserUseCase
{
    public async Task<GetUserResult> ExecuteAsync(Guid id, CancellationToken ct)
        => await Task.FromResult(new GetUserResult(id));
}
