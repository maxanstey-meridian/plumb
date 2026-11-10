using App.Persistence;

namespace App.Modules.Cases.Infrastructure;

public sealed class CaseRepository(AppDbContext db)
{
    public int Count() => db.Cases.Rows().Count();
}
