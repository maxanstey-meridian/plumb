namespace App.Modules.Crm.Contracts;

public static class CrmIntegration
{
    public static class Webhooks
    {
        public const string HandlerId = "acme-webhook";
    }

    public const string IntegrationId = "acme-crm";
    // A channel id that is also one of HTML's input types.
    public const string EmailChannelId = "email";
    public const string ExportId = "export";
    public const string CsvFormatId = "csv";
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
