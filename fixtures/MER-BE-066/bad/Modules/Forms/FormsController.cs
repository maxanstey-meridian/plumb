using App.Modules.Forms.Application.CreateForm;

namespace App.Modules.Forms;

public sealed record FormsPage(int Number, int Size);

public sealed class FormsController(CreateFormUseCase createForm)
{
    public bool Create(string title) => createForm.Execute(title);
}
