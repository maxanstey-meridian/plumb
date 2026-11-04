using App.Persistence;

namespace App.Modules.Records.Infrastructure;

public sealed class RecordRepository(AppDbContext db)
{
    public int Count() => db.Records.Rows().Count();
}
