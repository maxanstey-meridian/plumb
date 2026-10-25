// The folder names no module: Modules/Reference serves it, so Reference consumes ListColumn.
namespace Acme.Contracts.ReferenceData;
public sealed record ReferenceListResponse(Acme.Common.ListColumn Column);
