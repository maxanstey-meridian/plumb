namespace App.Modules.Orders;

// The app's own result types and a member named Results are no HTTP results: recording the adapter's status in
// them copies nothing into the response.
public sealed record AuditResult(int Status);

public sealed class Audit
{
    public List<AuditResult> Results { get; } = [];
}

public sealed class AuditFilter(Audit audit, ILogger<AuditFilter> logger) : IResultFilter
{
    public void OnResultExecuting(ResultExecutingContext context)
    {
        if (context.Result is not Adapted adapted) return;
        audit.Results.Add(new AuditResult(adapted.StatusCode));
        var check = new ValidationResult(adapted.StatusCode.ToString());
        logger.LogInformation("{Status} after {Count} checks: {Check}", adapted.StatusCode, audit.Results.Count, check.ErrorMessage);
    }

    public void OnResultExecuted(ResultExecutedContext context) { }
}
