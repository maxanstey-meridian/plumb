namespace Acme.Modules.Forms;
public sealed class FormsService { public string Make(string s) => Acme.Common.SlugRules.Slug(s); }
