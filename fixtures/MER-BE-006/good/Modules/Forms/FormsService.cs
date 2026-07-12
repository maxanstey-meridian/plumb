namespace Acme.Modules.Forms;
public sealed class FormsService : Acme.Common.Ports.IAddressLookup
{
    public string Make(string s) => Acme.Common.SlugRules.Slug(s);
    public Acme.Common.SubmissionContract? Submission { get; set; }
    public Acme.Common.SubmissionContract.SubmissionAudit? Audit { get; set; }
    public Acme.Common.SubmissionState State { get; set; }
    public Acme.Common.SubmissionItem? Item { get; set; }
    // AddressDto + NotFoundException referenced ONLY here — exempt per §7
    // (interface-file DTO rule; *Exception rule). IAddressLookup has 2 consumers.
    public object Find(string q) => new Acme.Common.Ports.AddressDto(q);
    public void Fail() => throw new Acme.Common.NotFoundException();
}
