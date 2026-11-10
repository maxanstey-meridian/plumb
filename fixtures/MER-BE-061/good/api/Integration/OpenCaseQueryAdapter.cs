using App.Modules.CaseTypes.Application.Ports;
using App.Modules.Cases.Contracts;

namespace App.Integration;

public sealed class OpenCaseQueryAdapter : IOpenCaseQuery
{
    public int CountOpen(Guid caseTypeId)
    {
        CaseSummary? none = null;
        return none is null ? 0 : 1;
    }
}
