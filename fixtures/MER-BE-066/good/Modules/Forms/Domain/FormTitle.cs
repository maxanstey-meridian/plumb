namespace App.Modules.Forms.Domain;

// The limit sits in Domain, where the root and every layer may read it.
public static class FormTitle
{
    public const int MaxLength = 200;
}
