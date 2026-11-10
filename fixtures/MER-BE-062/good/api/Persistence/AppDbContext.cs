using App.Modules.Cases.Domain;
using App.Modules.Forms.Domain;
using App.Modules.Records.Domain;
using Microsoft.EntityFrameworkCore;

namespace App.Persistence;

// The persistence root: its model names every module's entities and every module uses its type, but its type is no
// route between modules, and each module reads only the DbSet of its own entity.
public sealed class AppDbContext : DbContext
{
    public DbSet<CaseEntity> Cases { get; } = new();
    public DbSet<FormEntity> Forms { get; } = new();
    public DbSet<RecordEntity> Records { get; } = new();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CaseEntity>();
        modelBuilder.Entity<FormEntity>();
        modelBuilder.Entity<RecordEntity>();
    }
}
