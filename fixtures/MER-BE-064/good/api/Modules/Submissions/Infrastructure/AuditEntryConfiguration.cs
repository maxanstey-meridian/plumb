using App.Modules.Submissions.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace App.Modules.Submissions.Infrastructure;

public sealed class AuditEntryConfiguration
{
    public void Configure(EntityTypeBuilder<AuditEntry> builder)
    {
        builder.ToView("audit_log");
    }
}
