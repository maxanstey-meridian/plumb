namespace App.Modules.Forms.Application.CreateForm;

public sealed class CreateFormUseCase
{
    public Task<bool> ExecuteAsync(string title, CancellationToken cancellationToken) => Task.FromResult(title.Length > 0);
}
