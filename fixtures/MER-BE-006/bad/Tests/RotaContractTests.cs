// A test serving a contract is not a consumer: RetryBudget stays Forms'.
namespace Acme.Tests;
public sealed class RotaContractTests { public Acme.Contracts.Rota.RotaRetryResponse Sample { get; } = new(new(3)); }
