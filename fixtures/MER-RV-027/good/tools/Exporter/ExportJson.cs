using System.Text.Json;
using System.Text.Json.Serialization;

namespace App.Tools.Exporter;

// A tool beside the API that neither declares nor references a Rivet response: it writes files, not responses.
public static class ExportJson
{
    public static readonly JsonSerializerOptions Options = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
}
