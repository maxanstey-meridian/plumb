namespace App.Modules.Crm.Contracts;

public static class CrmIntegration
{
    public static class Webhooks
    {
        public const string HandlerId = "acme-webhook";
    }

    public const string IntegrationId = "acme-crm";
    public const string PanelId = "acmepanel";
}

public readonly record struct CrmConnector(string Name)
{
    public const string ConnectorId = "acme-connector";
}

// Production code that runs a connection test; its "Test" prefix doesn't make it a test double.
public sealed class TestCrmConnectionUseCase
{
    public const string ProbeId = "acme-probe";
}
