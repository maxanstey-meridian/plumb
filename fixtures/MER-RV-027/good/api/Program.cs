using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);
// Always sent: Never is the default, and a comparison sets nothing.
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never);
if (builder.Configuration["x"] is null && JsonSerializerOptions.Default.DefaultIgnoreCondition == JsonIgnoreCondition.WhenWritingNull) return;
// Newtonsoft is not RV-027's to read.
builder.Services.AddControllers().AddNewtonsoftJson(options => options.SerializerSettings.NullValueHandling = NullValueHandling.Ignore);
// DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull in a comment is not code.

var app = builder.Build();
app.Run();
