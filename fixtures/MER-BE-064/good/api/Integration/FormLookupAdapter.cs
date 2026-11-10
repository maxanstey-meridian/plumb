using App.Modules.Forms.Contracts;
using App.Modules.Submissions.Application.Ports;

namespace App.Integration;

public sealed class FormLookupAdapter : IFormLookup
{
    public string? NameOf(Guid formId)
    {
        FormSummary? none = null;
        return none is null ? null : formId.ToString();
    }
}
