namespace App.Modules.Forms.Application.CreateForm;

// A dependency inside a method body: no using, since the module's root namespace encloses this one.
public sealed class CreateFormUseCase
{
    public bool Execute(string title)
    {
        var limit = FormsRequestValidators.MaxTitleLength;
        return title.Length <= limit;
    }
}
