public sealed class CreateOrder
{
    public Order Execute(DateTimeOffset now) => new(now);
    // DateTime.Today and TimeProvider.System are examples, not calls.
    public string Description => "DateTime.UtcNow TimeProvider.System";
}
