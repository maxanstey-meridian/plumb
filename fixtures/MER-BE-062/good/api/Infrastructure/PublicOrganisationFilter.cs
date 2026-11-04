using App.Modules.Cases.Contracts;
using App.Modules.Forms.Contracts;
using App.Modules.Records.Contracts;

namespace App.Infrastructure;

// An enum two modules use, beside a class that uses all three: a route is a type, not a file, so only the class
// reaches modules and no module uses it.
public enum PublicKey
{
    Id,
    Slug,
}

public sealed class PublicOrganisationFilter
{
    public CaseSummary? OpenCase { get; set; }
    public FormSummary? Form { get; set; }
    public RecordSummary? Record { get; set; }
}
