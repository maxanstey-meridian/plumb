namespace App.Modules.Connectors.Contracts;

// Published by the Connectors module and carried by an Orders response, so these are responses too.
public sealed record ConnectorManifest(string? Returns = null);

public sealed record ConnectorStep(int Order = 0);
