using App.Modules.Billing.Application.Ports;

namespace App.Modules.Billing.Application;

public sealed class Reconcile(ILedgerPort ledger)
{
    // No Ledger name is written here: the ledger's entry type is inferred.
    public int Run()
    {
        var entry = ledger.Latest();
        return entry.Id;
    }
}
