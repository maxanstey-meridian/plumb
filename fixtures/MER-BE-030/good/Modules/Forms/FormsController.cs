using App.Modules.Forms.Application.CreateForm;
using Microsoft.AspNetCore.Mvc;

namespace App.Modules.Forms;

public sealed class FormsController(CreateFormUseCase createForm) : ControllerBase
{
    public Task<bool> Create(string title, CancellationToken cancellationToken) => createForm.ExecuteAsync(title, cancellationToken);
}
