# Payments Invariants

## PAY-001: A Payment Settles Exactly One Invoice

**Rule:** A payment settles one invoice, which then never changes (BILL-001).

**Why:** A payment split across invoices can't be refunded cleanly.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`
