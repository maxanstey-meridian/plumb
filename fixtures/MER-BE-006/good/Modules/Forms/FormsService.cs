namespace Acme.Modules.Forms;
public sealed class FormsService : Acme.Common.Ports.IAddressLookup
{
    public string Make(string s) => Acme.Common.SlugRules.Slug(s);
    public Acme.Common.SubmissionContract? Submission { get; set; }
    public Acme.Common.SubmissionContract.SubmissionAudit? Audit { get; set; }
    public Acme.Common.SubmissionState State { get; set; }
    public Acme.Common.SubmissionItem? Item { get; set; }
    // RequestQuota's and RetryWindow's only module consumer; the host is the second.
    public Acme.Common.RequestQuota? Quota { get; set; }
    public Acme.Common.RetryWindow? Retry { get; set; }
    // Ledger's module consumers are Forms and Users (through its global alias); Clock is globally imported.
    public Acme.Common.Ledger? Ledger { get; set; }
    public int Stamp() => Acme.Common.Clock.Now;
    // AddressDto is named only here, but IAddressLookup's signature names it, so Users consumes it too.
    // NotFoundException is referenced only here — exempt per §7 (*Exception rule).
    public Acme.Common.Ports.AddressDto Find(string q) => new(q);
    public void Fail() => throw new Acme.Common.NotFoundException();
}
