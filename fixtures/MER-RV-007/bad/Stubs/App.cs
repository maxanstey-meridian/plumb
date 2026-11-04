namespace App;

public sealed record OrderPage;

public sealed record Page<T>(T? Item = default);

public sealed record Result<T>(T? Value = default);

public sealed class OrderEndpoint
{
    public RivetResult Success(OrderPage page) => new(200, page);
}

public static class OrdersContract
{
    public static OrderEndpoint List { get; } = new();
}
