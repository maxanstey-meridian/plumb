namespace Newtonsoft.Json
{
    public enum NullValueHandling
    {
        Include,
        Ignore,
    }

    public sealed class JsonSerializerSettings
    {
        public NullValueHandling NullValueHandling { get; set; }
    }
}

namespace Microsoft.AspNetCore.Mvc
{
    public sealed class MvcNewtonsoftJsonOptions
    {
        public Newtonsoft.Json.JsonSerializerSettings SerializerSettings { get; } = new();
    }
}

namespace Microsoft.Extensions.DependencyInjection
{
    public static class NewtonsoftJsonMvcBuilderExtensions
    {
        public static IMvcBuilder AddNewtonsoftJson(this IMvcBuilder builder, Action<Microsoft.AspNetCore.Mvc.MvcNewtonsoftJsonOptions> setupAction) => builder;
    }
}
