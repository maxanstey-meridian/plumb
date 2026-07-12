public static class OrdersEndpoints
{
    public static IEndpointRouteBuilder MapOrdersEndpoints(this IEndpointRouteBuilder endpoints) => endpoints;
    public static Microsoft.AspNetCore.Routing.IEndpointRouteBuilder MapAdminEndpoints(
        this Microsoft.AspNetCore.Routing.IEndpointRouteBuilder endpoints) => endpoints;
    public static global::Microsoft.AspNetCore.Routing.IEndpointRouteBuilder MapMemberEndpoints(
        this global::Microsoft.AspNetCore.Routing.IEndpointRouteBuilder endpoints) => endpoints;
}
