public class PostgresSqliteTests
{
    private static AppDbContext Db() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("DataSource=:memory:").Options);
}
