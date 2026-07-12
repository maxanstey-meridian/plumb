public sealed class Order
{
    public DateTime CreatedAt { get; } = DateTime.UtcNow;
    public DateTime Day { get; } = DateTime.Today;
    public DateTimeOffset ObservedAt { get; } = TimeProvider.System.GetUtcNow();
}
