using App.Modules.Forms.Application.Ports;

namespace App.Modules.Forms.Infrastructure;

public sealed class FormStore : IFormRepository
{
    public Task<bool> ExistsAsync(string title, CancellationToken cancellationToken) => Task.FromResult(false);
}
