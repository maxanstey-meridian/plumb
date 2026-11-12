using App.Modules.Forms.Application.Ports;

namespace App.Modules.Forms.Application.CreateForm;

public sealed class CreateFormUseCase(IFormRepository forms)
{
    public async Task<bool> ExecuteAsync(string title, CancellationToken cancellationToken) => !await forms.ExistsAsync(title, cancellationToken);
}
