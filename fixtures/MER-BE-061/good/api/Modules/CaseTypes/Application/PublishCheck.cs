using App.Modules.CaseTypes.Application.Ports;
using App.Modules.Connectors.Contracts;

namespace App.Modules.CaseTypes.Application;

public sealed class PublishCheck(IOpenCaseQuery openCases, ConnectorRef connector);
