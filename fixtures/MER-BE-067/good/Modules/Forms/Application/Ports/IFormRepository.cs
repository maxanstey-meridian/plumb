namespace App.Modules.Forms.Application.Ports;

public interface IFormRepository
{
    Task<bool> ExistsAsync(string title, CancellationToken cancellationToken);
}
