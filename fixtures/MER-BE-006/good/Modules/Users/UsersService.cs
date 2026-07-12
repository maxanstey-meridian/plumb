namespace Acme.Modules.Users;
public sealed class UsersService
{
    public string Make(string s) => Acme.Common.SlugRules.Slug(s);
    public Acme.Common.Ports.IAddressLookup? Lookup { get; set; }
    public Acme.Common.SubmissionContract? Submission { get; set; }
}
