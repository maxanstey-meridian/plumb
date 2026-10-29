namespace App.Tests;

public sealed class InvoiceDeciderTests
{
    [Fact]
    public void A_paid_invoice_cannot_change() => Assert.NotNull(App.Modules.Billing.InvoiceDecider.Refusal(true));
}
