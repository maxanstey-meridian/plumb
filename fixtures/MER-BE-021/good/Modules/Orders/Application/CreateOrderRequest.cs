using Paramore.Brighter;

public sealed record CreateOrderRequest;
public sealed record class UpdateOrderRequest;

public sealed class OrderEntity { }

public sealed class SubmitOrderCommand(Id id) : Command(id) { }

public sealed class CancelOrderCommand(Id id) : global::Paramore.Brighter.Command(id) { }
