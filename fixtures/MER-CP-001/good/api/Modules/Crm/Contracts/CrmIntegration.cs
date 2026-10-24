namespace App.Modules.Crm.Contracts;

public static class CrmIntegration
{
    public const string IntegrationId = "acme-crm";
    public const string ExportId = "export";
    // A channel id that is also one of HTML's input types.
    public const string EmailChannelId = "email";
    public const string CsvFormatId = "csv";
    public const string IntegrationKey = "acme-key";
    private const string SecretId = "acme-secret";
}

// The dev seed's stand-in connector; its ids aren't the server's.
public sealed class FakeCrmLookup
{
    public const string LookupId = "acme-lookup";
}
