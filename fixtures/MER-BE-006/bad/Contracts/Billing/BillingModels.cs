// Nothing serves this contract, and there is no Billing module: it passes nothing on, so Ledger stays Forms'.
namespace Acme.Contracts.Billing;
public sealed record BillingResponse(Acme.Common.Ledger Ledger);
