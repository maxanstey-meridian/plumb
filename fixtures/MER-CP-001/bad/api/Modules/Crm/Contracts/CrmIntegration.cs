namespace App.Modules.Crm.Contracts;

public static class CrmIntegration
{
    public static class Webhooks
    {
        public const string HandlerId = "acme-webhook";
    }

    public const string IntegrationId = "acme-crm";
}

public readonly record struct CrmConnector(string Name)
{
    public const string ConnectorId = "acme-connector";
}
