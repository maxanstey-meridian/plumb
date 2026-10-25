// Users writes Ledger only through this global alias, so it is Ledger's second consumer beside Forms; and a global
// using static imports Clock's members everywhere, so modules call Now without naming Clock: it is shared.
global using LedgerEntry = Acme.Common.Ledger;
global using static Acme.Common.Clock;
