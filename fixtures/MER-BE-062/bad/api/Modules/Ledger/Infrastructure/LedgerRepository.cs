using App.Persistence;

namespace App.Modules.Ledger.Infrastructure;

// No Billing name is written here: the root's method reads Billing's invoices.
public sealed class LedgerRepository(AppDbContext db)
{
    public decimal InvoiceTotal() => db.LatestInvoiceTotal();
}
