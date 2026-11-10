using App.Modules.Forms.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace App.Modules.Forms.Infrastructure;

public sealed class FormEntityConfiguration
{
    public void Configure(EntityTypeBuilder<FormEntity> builder)
    {
        builder.ToTable("forms");
    }
}
