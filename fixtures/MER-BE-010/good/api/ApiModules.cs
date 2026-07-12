public static class ApiModules
{
    public static IServiceCollection AddApiModules(this IServiceCollection services) =>
        services.AddOrdersApiModule();
}
