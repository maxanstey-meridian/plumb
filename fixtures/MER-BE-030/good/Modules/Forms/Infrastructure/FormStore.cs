using App.Data;

namespace App.Modules.Forms.Infrastructure;

// An adapter reads the context; only a controller is kept away from it.
public sealed class FormStore(AppDbContext db)
{
    public bool Ready() => db is not null;
}
