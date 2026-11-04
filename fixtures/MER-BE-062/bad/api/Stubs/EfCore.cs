// Just enough of Entity Framework Core for the persistence root below, so the fixture needs no package.
namespace Microsoft.EntityFrameworkCore
{
    public class DbContext
    {
        public virtual int SaveChanges() => 0;
    }

    public class DbSet<T> where T : class
    {
        public IEnumerable<T> Rows() => [];
    }
}
