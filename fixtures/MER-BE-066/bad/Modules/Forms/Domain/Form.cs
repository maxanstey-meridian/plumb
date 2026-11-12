using static App.Modules.Forms.FormsRequestValidators;

namespace App.Modules.Forms.Domain;

public sealed class Form(string title)
{
    public bool Fits => title.Length <= MaxTitleLength;
}
