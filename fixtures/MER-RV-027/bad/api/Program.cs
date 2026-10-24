using System.Text.Json;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);
builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault;
});

var app = builder.Build();
app.Run();

// An IConfigureOptions<JsonOptions> sets the host's options too.
sealed class JsonDefaults : IConfigureOptions<Microsoft.AspNetCore.Http.Json.JsonOptions>
{
    public void Configure(Microsoft.AspNetCore.Http.Json.JsonOptions options) =>
        options.SerializerOptions.DefaultIgnoreCondition = global::System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
}
