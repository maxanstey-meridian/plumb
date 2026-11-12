using App.Modules.Forms.Domain;

namespace App.Modules.Forms;

// A root file reads the layers, and its neighbours at the root.
public static class FormsRequestValidators
{
    public static bool Accepts(string title) => title.Length <= FormTitle.MaxLength;
}
