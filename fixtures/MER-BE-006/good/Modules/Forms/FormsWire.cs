// Forms is one consumer of each of these; the second comes only through a transport contract that other code serves.
namespace Acme.Modules.Forms;
public sealed record FormsWire(Acme.Common.ShiftWindow Window, Acme.Common.ListColumn Column, Acme.Common.RuleKind Kind, Acme.Common.BuildStamp Stamp);
public sealed record FormsLimits(Acme.Common.QuotaLimit Quota, Acme.Common.ShiftSwap Swap);
