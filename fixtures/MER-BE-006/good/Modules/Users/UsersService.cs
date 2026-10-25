namespace Acme.Modules.Users;
public sealed class UsersService
{
    public string Make(string s) => Acme.Common.SlugRules.Slug(s);
    public Acme.Common.Ports.IAddressLookup? Lookup { get; set; }
    public Acme.Common.SubmissionContract? Submission { get; set; }
    public LedgerEntry? Entry { get; set; }
    public string Address(string remote) => Acme.Common.ClientAddress.Of(remote);
}
public sealed class UsersQuota { public void Fail() => throw new Acme.Common.Errors.QuotaExceededException(new(1)); }
