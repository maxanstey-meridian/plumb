using App.Modules.Forms.Application.Ports;
using Microsoft.AspNetCore.Mvc;

namespace App.Modules.Forms;

public sealed class FormsController(IFormRepository forms) : ControllerBase
{
    public Task<bool> Exists(string title, CancellationToken cancellationToken) => forms.ExistsAsync(title, cancellationToken);
}
