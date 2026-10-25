// A host test project's use of RetryBudget is not the host consuming it: Forms stays its only consumer.
using Acme.Common;
namespace Acme.Tests;
public sealed class HostTests { public RetryBudget Sample { get; } = new(3); }
