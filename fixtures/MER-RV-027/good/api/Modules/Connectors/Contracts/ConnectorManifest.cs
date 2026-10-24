namespace App.Modules.Connectors.Contracts;

// Same names as the transport records, in the module's own namespace: no route reaches these.
public sealed record ConnectorOperation(string Id, ConnectorManifest Manifest, int Order = 0);

public sealed record ConnectorManifest(string? Returns = null);
