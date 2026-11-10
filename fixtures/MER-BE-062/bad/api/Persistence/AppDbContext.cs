using App.Modules.Billing.Domain;
using Microsoft.EntityFrameworkCore;

namespace App.Persistence;

// The persistence root: its type is no route between modules, but each member that reads another module's data is.
public sealed class AppDbContext : DbContext
{
    public DbSet<InvoiceEntity> Invoices { get; } = new();

    public decimal LatestInvoiceTotal() => Invoices.Rows().Count();
}
