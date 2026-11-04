using App.Persistence;

namespace App.Modules.Forms.Infrastructure;

public sealed class FormRepository(AppDbContext db)
{
    public int Count() => db.Forms.Rows().Count();
}
