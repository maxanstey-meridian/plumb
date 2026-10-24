namespace App.Modules.Orders;

// The app's own result types, a member named Results, another writer, an entry's own Result and a filter's own
// method named like a controller helper are no HTTP results: recording the adapter's status in them copies
// nothing into the response.
public sealed record AuditResult(int Status);
public sealed record Content(object? Body);

public sealed class AuditEntry
{
    public int Result { get; set; }
}

public sealed class Audit
{
    public List<AuditResult> Results { get; } = [];

    public void Record(Adapted adapted) => Results.Add(new AuditResult(adapted.StatusCode));
}

public sealed class AuditFilter(Audit audit, Channel<AuditEntry> channel, ILogger<AuditFilter> logger) : IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        if (context.Result is not Adapted adapted)
        {
            await next();
            return;
        }
        audit.Results.Add(new AuditResult(adapted.StatusCode));
        var check = new ValidationResult(adapted.StatusCode.ToString());
        logger.LogInformation("{Status} after {Count} checks: {Check}", adapted.StatusCode, audit.Results.Count, check.ErrorMessage);
        var entry = new AuditEntry();
        entry.Result = adapted.StatusCode;
        await channel.Writer.WriteAsync(entry);
        await channel.Writer.WriteAsync(new AuditEntry { Result = adapted.StatusCode });
        logger.LogDebug("{Body}", new Content(adapted.Value));
        var ok = Ok(adapted.StatusCode);
        if (!ok) logger.LogWarning("refused");
        await next();
    }

    private static bool Ok(int? status) => status is >= 200 and < 300;
}
