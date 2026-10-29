# Billing Invariants

## BILL-001: A Paid Invoice Never Changes

**Rule:** Once an invoice is paid, nothing about it changes. Its PDF is stored with its SHA-256 hash, and plumb's
MER-BE-005 keeps other modules out of Billing's internals.

**Why:** A paid invoice is what the customer was charged; changing it rewrites history.

### Notes

The trigger can be applied by hand where a migration can't run:

```sh
# a shell comment
psql -f refuse.sql
```

**Owner:** `InvoiceDecider.Refusal()` refuses the change, and the `invoices_immutable` trigger
(`Migrations/`) refuses it in storage, which `bin/release.sh` applies; `BannedSymbols.txt` keeps the clock honest,
`app.bicep` deploys it, and .NET's `System.Net.Http` is never called here. Payments leans on it (`PAY-001`) and
records its part in its own `INVARIANTS.md`.

**Proof:** `InvoiceDeciderTests.A_paid_invoice_cannot_change`; `InvoiceDeciderTests`;
`Invoicing.feature`; `invoice.spec.ts` (no `now()`, `clock_timestamp()`, `statement_timestamp()` or
`current_timestamp` anywhere in the server's code outside its migrations).

### PAY-001 depends on this

Finance calls a paid invoice `settled_once`; that is their word, not a name in the code.

## Notes on PAY-001

PAY-001 settles each invoice once, and this module keeps it unchanged afterwards.

## SHA-256 Hashes

Each stored PDF is checked against its SHA-256 hash when it is read back, and is encrypted with AES-256 at rest.
Its emailed copy carries RFC-822 dates and the customer's language as an ISO-639 code.

## MER-BE-005 Coverage

plumb's MER-BE-005 keeps other modules out of Billing's internals, so only this module writes an invoice.
