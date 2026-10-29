# Billing Invariants

## BILL-001: A Paid Invoice Never Changes

**Rule:** Once an invoice is paid, nothing about it changes.

**Why:** A paid invoice is what the customer was charged; changing it rewrites history.

**Owner:** `InvoiceDecider.Refusal` refuses the change, and the `invoices_immutable` trigger
(`Migrations/`) refuses it in storage; `BannedSymbols.txt` keeps the clock honest, and .NET's
`System.Net.Http` is never called here. Payments leans on it (PAY-001).

**Proof:** `InvoiceDeciderTests.A_paid_invoice_cannot_change`; `InvoiceDeciderTests`;
`Invoicing.feature`; `invoice.spec.ts` (no `current_timestamp` is read).
