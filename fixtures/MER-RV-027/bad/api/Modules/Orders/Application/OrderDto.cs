namespace App.Modules.Orders.Application;

// Same name as the transport response record: the transport one is still checked, this one isn't.
public sealed record OrderDto(Guid Id, string? Note = null);
