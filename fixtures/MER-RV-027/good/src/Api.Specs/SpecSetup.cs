using System.Text.Json;
using System.Text.Json.Serialization;
using Rivet;

namespace App.Specs;

// A test project known only by its test SDK: its serializer options and its own contract are test code.
public static class SpecSetup
{
    public static readonly JsonSerializerOptions Options = new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };
}

[RivetContract]
public static class SpecContract
{
    public static readonly RouteDefinition<SpecProbeDto> Probe = Define.Get<SpecProbeDto>("/spec/probe");
}

public sealed record SpecProbeDto(int Attempt = 0);

public sealed class SpecProbeView
{
    public int Attempt { get; init; }
}
