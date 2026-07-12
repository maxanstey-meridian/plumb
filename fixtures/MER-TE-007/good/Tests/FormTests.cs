public class FormTests
{
    // options.UseInMemoryDatabase("documentation-only");
    private const string Example = "options.UseInMemoryDatabase(\"documentation-only\")";

    private static AppDbContext Db() =>
        new(new DbContextOptionsBuilder<AppDbContext>().UseSqlite("DataSource=:memory:").Options);
}
