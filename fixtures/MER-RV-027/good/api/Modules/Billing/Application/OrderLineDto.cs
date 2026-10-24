namespace App.Modules.Billing.Application;

// Same name as the Orders response record, different namespace: not part of any response.
public sealed record OrderLineDto(string Sku, int? Quantity = null);
