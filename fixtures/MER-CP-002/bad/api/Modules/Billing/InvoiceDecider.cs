namespace App.Modules.Billing;

public static class InvoiceDecider
{
    public static string? Refusal(bool paid) => paid ? "A paid invoice can't change." : null;
}
