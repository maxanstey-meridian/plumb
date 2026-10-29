# Payments Invariants

## PAY-001: A Payment Settles Exactly One Invoice

**Rule:** A payment settles one invoice, which then never changes (BILL-001).

**Why:** A payment split across invoices can't be refunded cleanly.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`

## PAY-002 A Refund Reverses One Payment

**Rule:** A rule headed with a space after its ID is read and checked like any other.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`

## PAY-003 — A Payment Is Recorded Once

**Rule:** So is a rule headed with a dash after its ID.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`
