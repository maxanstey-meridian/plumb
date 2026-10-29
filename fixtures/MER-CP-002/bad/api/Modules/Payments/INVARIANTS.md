# Payments Invariants

## BILL-001: A Second Rule With The Same ID

**Rule:** IDs are unique across the repository, and this one leans on GONE-001, which no file defines.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`

## ISO-001: A Payment's Currency Is A Three-Letter Code

**Rule:** A colon heading defines a rule whatever its prefix, so its names are checked.

**Owner:** `CurrencyGone`

**Proof:** `InvoiceDeciderTests`
