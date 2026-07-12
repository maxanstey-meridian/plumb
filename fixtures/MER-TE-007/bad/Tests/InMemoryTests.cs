public class InMemoryTests
{
    private static AppDbContext Db() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase("t").Options);
}
