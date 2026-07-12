public static class InMemoryDevelopmentHost
{
    public static void Configure(DbContextOptionsBuilder options) =>
        options.UseInMemoryDatabase("development");
}
