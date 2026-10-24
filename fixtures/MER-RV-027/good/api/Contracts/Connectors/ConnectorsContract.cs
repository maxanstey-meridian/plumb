using Rivet;

namespace App.Contracts.Connectors;

[RivetContract]
public static class ConnectorsContract
{
    public static readonly RouteDefinition<ConnectorOperation> Get = Define.Get<ConnectorOperation>("/api/connectors/{id}");
}

public sealed record ConnectorOperation(string Id, ConnectorManifest Manifest);

public sealed record ConnectorManifest(string? Returns);
