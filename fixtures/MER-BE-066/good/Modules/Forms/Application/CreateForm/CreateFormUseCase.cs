using App.Modules.Forms.Domain;

namespace App.Modules.Forms.Application.CreateForm;

public sealed class CreateFormUseCase
{
    public bool Execute(string title) => title.Length <= FormTitle.MaxLength;
}
