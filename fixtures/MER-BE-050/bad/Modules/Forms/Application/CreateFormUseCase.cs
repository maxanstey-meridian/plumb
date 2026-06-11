namespace App.Modules.Forms.Application;
public sealed class CreateFormUseCase
{
    public Result Execute(CreateFormCommand command)
    {
        if (string.IsNullOrEmpty(command.Name)) return Result.Validation(new[] { "name required" });
        return Result.Success();
    }
}
