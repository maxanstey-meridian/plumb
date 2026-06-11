namespace App.Modules.Forms.Application;
public sealed record CreateFormCommand(string Name);
public sealed record CreateFormResult(Guid Id);
public sealed class CreateFormUseCase
{
    public CreateFormResult Execute(CreateFormCommand command) => new(Guid.NewGuid());
}
