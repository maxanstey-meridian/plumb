using App.Modules.Forms.Domain;

namespace App.Modules.Forms.Infrastructure;

public sealed class FormConfiguration
{
    public int TitleColumnLength => FormTitle.MaxLength;
}
