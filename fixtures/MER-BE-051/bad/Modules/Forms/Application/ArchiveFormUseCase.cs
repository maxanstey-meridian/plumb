namespace App.Modules.Forms.Application;
public sealed class ArchiveFormUseCase
{
    // A record struct is a record too.
    public readonly record struct Command(Guid Id);
    public bool Execute(Command command) => true;
}
