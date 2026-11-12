using App.Modules.Forms.Application.CreateForm;

namespace App.Modules.Forms;

public sealed class FormsController(CreateFormUseCase createForm)
{
    public bool Create(string title) => FormsRequestValidators.Accepts(title) && createForm.Execute(title);
}
