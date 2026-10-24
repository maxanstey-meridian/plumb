namespace App.Modules.Forms.Application;
// Same name as the transport response; the contract's own namespace holds the one it carries.
public sealed record FormResponse(string Title, int Version);
