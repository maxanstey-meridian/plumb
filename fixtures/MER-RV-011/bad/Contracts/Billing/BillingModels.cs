namespace App.Contracts.Billing;
// Same name in a namespace FormsContract doesn't import: the Forms route still carries the module's FormDraft.
public sealed record FormDraft(string Invoice);
