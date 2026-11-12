namespace App.Modules.Forms.Contracts;

public sealed record FormList(IReadOnlyList<string> Titles, FormsPage Page);
