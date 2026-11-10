namespace App;

public sealed record CreateOrderRequest(string Name);

public sealed record CreateOrderResponse(Guid Id);

public sealed record ListOrdersResponse;

public sealed record OrderDraftResponse;

public sealed record SaveOrderDraftRequest;

public sealed record ListMembersResponse;

public sealed record InviteMemberRequest;

public sealed record InviteMemberResponse;

// What `useCase` stands for in the controllers, which declare no such member: a static one, brought in by a global using static.
public sealed class Call
{
    public static implicit operator Task<CreateOrderResponse>(Call call) => Task.FromResult(new CreateOrderResponse(Guid.Empty));

    public static implicit operator Task<ListOrdersResponse>(Call call) => Task.FromResult(new ListOrdersResponse());

    public static implicit operator Task<OrderDraftResponse>(Call call) => Task.FromResult(new OrderDraftResponse());

    public static implicit operator Task<ListMembersResponse>(Call call) => Task.FromResult(new ListMembersResponse());

    public static implicit operator Task<InviteMemberResponse>(Call call) => Task.FromResult(new InviteMemberResponse());
}

public sealed class UseCase
{
    public Call ExecuteAsync(params object?[] arguments) => new();

    public OrderDraftResponse Save(Guid id, SaveOrderDraftRequest request) => new();

    public OrderDraftResponse Remove(Guid id) => new();
}

public static class UseCases
{
    public static UseCase useCase { get; } = new();
}

// Another contract's field, bound where OrdersContract's is meant: a namesake that is not OrdersContract.
public static class AdminOrdersContract
{
    public static readonly RouteDefinition<CreateOrderRequest, CreateOrderResponse> Create = Define
        .Post<CreateOrderRequest, CreateOrderResponse>("/api/admin/orders");
}
