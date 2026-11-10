using App.Modules.Submissions.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace App.Modules.Submissions.Infrastructure;

public sealed class FormRefConfiguration
{
    public void Configure(EntityTypeBuilder<FormRef> builder)
    {
        builder.ToView("forms");
    }
}
