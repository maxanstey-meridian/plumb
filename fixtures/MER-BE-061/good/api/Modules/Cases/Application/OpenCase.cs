using App.Modules.CaseTypes.Contracts;
using App.Modules.Connectors.Contracts;

namespace App.Modules.Cases.Application;

// Cases depends on CaseTypes, and through it on Connectors, as .plumb-modules.json claims.
public sealed class OpenCase(CaseTypeSummary type, ConnectorRef connector);
