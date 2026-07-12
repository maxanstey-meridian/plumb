namespace Acme.Common;

public sealed class SubmissionContract
{
    public SubmissionDetails? Details { get; init; }

    public sealed record SubmissionAudit(SubmissionState State);

    public SubmissionAudit? Audit { get; init; }
    public IReadOnlyList<SubmissionItem> Items { get; init; } = [];
}

public enum SubmissionState { Draft, Submitted }

public sealed record SubmissionDetails(string Reference);

public sealed record SubmissionItem(string Name);
