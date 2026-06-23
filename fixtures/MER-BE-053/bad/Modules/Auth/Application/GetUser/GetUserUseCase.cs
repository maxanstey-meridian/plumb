namespace App.Modules.Auth.Application.GetUser;

// BAD: the use case returns the wire DTO directly — application coupled to the HTTP contract.
public sealed class GetUserUseCase
{
    public async Task<AuthUserDto> ExecuteAsync(Guid id, CancellationToken ct)
        => await Task.FromResult(new AuthUserDto(id));
}
