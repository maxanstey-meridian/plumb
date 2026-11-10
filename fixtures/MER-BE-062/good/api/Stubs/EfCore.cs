// Just enough of Entity Framework Core for the persistence root below, so the fixture needs no package.
namespace Microsoft.EntityFrameworkCore
{
    public class DbContext
    {
        public virtual int SaveChanges() => 0;
        protected virtual void OnModelCreating(ModelBuilder modelBuilder) { }
    }

    public class DbSet<T> where T : class
    {
        public IEnumerable<T> Rows() => [];
    }

    public class ModelBuilder
    {
        public Metadata.Builders.EntityTypeBuilder<T> Entity<T>() where T : class => new();
    }
}

namespace Microsoft.EntityFrameworkCore.Metadata.Builders
{
    public class EntityTypeBuilder<T> where T : class { }
}
