// A stand-in for the EF Core package, in its real namespace: the rules judge a type by its full name.
namespace Microsoft.EntityFrameworkCore
{
    public class DbContext { }

    public static class EntityFrameworkQueryableExtensions
    {
        public static Task<List<T>> ToListAsync<T>(this IQueryable<T> source, CancellationToken cancellationToken = default) =>
            Task.FromResult(source.ToList());
    }
}
