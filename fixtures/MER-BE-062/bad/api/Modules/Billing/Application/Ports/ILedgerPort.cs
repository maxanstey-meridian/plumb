using App.Modules.Ledger.Contracts;

namespace App.Modules.Billing.Application.Ports;

public interface ILedgerPort
{
    Entry Latest();
}
