namespace App.Modules.Billing;

public static class InvoiceDecider
{
    // Removed was replaced by Refusal.
    public static string? Refusal(bool paid) => paid ? "A paid invoice can't change." : null;
}
