using App.Infrastructure;
using App.Modules.Records.Application.Ports;

namespace App.Modules.Records.Application;

// App.Modules.Cases.Contracts.CaseSummary is documentation, not a dependency.
public sealed class ListRecords(ICaseLookup cases)
{
    public const string Example = "App.Modules.Cases.Contracts.CaseSummary";

    public PublicKey Key { get; } = PublicKey.Slug;
}
