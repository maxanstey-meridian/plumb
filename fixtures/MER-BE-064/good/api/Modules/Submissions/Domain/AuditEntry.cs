namespace App.Modules.Submissions.Domain;

// Mapped onto a database view that no module maps with ToTable: a view is nobody's table.
public sealed class AuditEntry
{
    public Guid Id { get; set; }
}
