namespace App.Modules.Forms.Application;
public sealed class CreateFormUseCase
{
    public sealed record Command(string Name);
    public sealed record Result(Guid Id);
    public Result Execute(Command command) => new(Guid.NewGuid());
}
