namespace App;

public sealed record OrderPage;

public sealed record Line(string Name);

public sealed class OrderEndpoint
{
    public RivetResult Success(OrderPage page) => new(200, page);
}

public static class OrdersContract
{
    public static OrderEndpoint List { get; } = new();
}

public sealed class AuditContext
{
    public object? Result { get; set; }
}

public sealed class TransactionContext
{
    public object? Result { get; set; }
}

public sealed class Outcome
{
    public T Match<T>(Func<object, T> ok, Func<object, T> error) => ok(this);

    public Task<T> MatchAsync<T>(Func<object, Task<T>> ok, Func<object, Task<T>> error) => ok(this);
}

public sealed class Result<T>
{
    public T? Value { get; init; }
}
