using App.Modules.Cases.Contracts;
using App.Modules.Forms.Contracts;
using App.Modules.Records.Contracts;

namespace App.Modules.Forms.Checks;

// Test code in its own test project: it may use every module.
public sealed class FormsChecks
{
    public CaseSummary? OpenCase { get; set; }
    public FormSummary? Form { get; set; }
    public RecordSummary? Record { get; set; }
}
