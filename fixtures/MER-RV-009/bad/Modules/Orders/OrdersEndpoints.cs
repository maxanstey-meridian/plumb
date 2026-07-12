public static class OrdersEndpoints
{
    public static WebApplication MapOrdersEndpoints(this WebApplication app) => app;
    public static Microsoft.AspNetCore.Builder.WebApplication MapAdminEndpoints(
        this Microsoft.AspNetCore.Builder.WebApplication app) => app;
    public static global::Microsoft.AspNetCore.Builder.WebApplication MapMemberEndpoints(
        this global::Microsoft.AspNetCore.Builder.WebApplication app) => app;
    public static object MapObjectEndpoints(this object target) => target;
    public static CustomEndpointBuilder MapCustomEndpoints(this CustomEndpointBuilder target) => target;
}
