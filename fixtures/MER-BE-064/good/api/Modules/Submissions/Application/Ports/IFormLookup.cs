namespace App.Modules.Submissions.Application.Ports;

// Submissions reads forms through this port, which the host bridges to Forms (api/Integration/FormLookupAdapter.cs).
public interface IFormLookup
{
    string? NameOf(Guid formId);
}
