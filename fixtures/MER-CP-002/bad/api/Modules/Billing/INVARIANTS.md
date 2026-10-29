# Billing Invariants

## BILL-001: A Paid Invoice Never Changes

**Rule:** Once an invoice is paid, nothing about it changes (see BILL-009).

### Notes

The trigger can be applied by hand where a migration can't run:

```sh
# a shell comment
psql -f refuse.sql
```

**Owner:** `InvoiceDecider.Removed`; `GoneService`; `Modules/Gone/`; `Gone.Method()`; `gone.bicep`; `refuse_deleted_change`

**Proof:** `GoneTests`; `InvoiceDeciderTests.A_deleted_test`; `Gone.feature`; `gone.spec.ts`;
`A_deleted_test_method`; `invoice.spec.ts`; `gone.bicep`; `invoiceGoneTests`

## BILL-002: An Invoice Has No Proof

**Rule:** Nothing proves this.

**Owner:** `InvoiceDecider`

## BILL-003: An Invoice Has No Owner (replaces BILL-077)

**Rule:** Nothing enforces this.

**Proof:** `InvoiceDeciderTests`

## BILL-004 — A Heading Written Another Way

**Rule:** A dash after the ID still heads a rule, so its missing Proof is reported.

**Owner:** `InvoiceDecider`

## BILL-005 A Heading With A Space After Its ID

**Rule:** A space after the ID still heads a rule, so its names are checked.

**Owner:** `SpacedGone`

**Proof:** `InvoiceDeciderTests`

## BILL-006

**Rule:** A bare ID still heads a rule, so its names are checked and its missing title is reported.

**Owner:** `BareGone`

**Proof:** `InvoiceDeciderTests`

## BILL-008:

**Rule:** A colon with nothing after it is no title either.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`

# BILL-007: A Rule Headed At Level 1

**Rule:** A level-1 heading isn't read as a rule, so it is reported and nothing under it is checked.

**Owner:** `LevelOneGone`

## BILL-01: An ID With Two Digits

**Rule:** An ID needs three digits, so this heading is reported and nothing under it is checked.

**Owner:** `NumberGone`

## SHA-1 Notes

Without a colon after it, a word with a short number is no ID, so this is an ordinary heading.
