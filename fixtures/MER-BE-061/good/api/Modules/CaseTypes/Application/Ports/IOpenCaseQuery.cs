namespace App.Modules.CaseTypes.Application.Ports;

// CaseTypes owns this port. The host bridges it to Cases (api/Integration/OpenCaseQueryAdapter.cs).
public interface IOpenCaseQuery
{
    int CountOpen(Guid caseTypeId);
}
