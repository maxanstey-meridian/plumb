# Payments Invariants

## PAY-001: A Payment Settles Exactly One Invoice

**Rule:** A payment settles one invoice, which then never changes (BILL-001), in its own currency (ISO-001).

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

## ISO-001: A Payment's Currency Is A Three-Letter Code

**Rule:** A colon heading defines a rule whatever its prefix, so payments cite ISO-001 like any rule, while ISO-639
stays prose.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`
