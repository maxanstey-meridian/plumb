using App.Modules.Cases.Contracts;
using App.Modules.Forms.Contracts;
using App.Modules.Records.Application.Ports;
using App.Modules.Records.Contracts;

namespace App.Integration;

// The host bridges Records' port to Cases. It may use every module.
public sealed class CaseLookupAdapter : ICaseLookup
{
    public CaseSummary? Find(Guid id) => null;

    public FormSummary? Form { get; set; }
    public RecordSummary? Record { get; set; }
}
