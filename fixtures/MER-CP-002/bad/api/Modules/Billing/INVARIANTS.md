# Billing Invariants

## BILL-001: A Paid Invoice Never Changes

**Rule:** Once an invoice is paid, nothing about it changes (see BILL-009).

### Notes

The trigger can be applied by hand where a migration can't run:

```sh
# a shell comment
psql -f refuse.sql
```

**Owner:** `InvoiceDecider.Removed`; `GoneService`; `Modules/Gone/`; `Gone.Method()`; `gone.bicep`

**Proof:** `GoneTests`; `InvoiceDeciderTests.A_deleted_test`; `Gone.feature`; `gone.spec.ts`;
`A_deleted_test_method`; `invoice.spec.ts`

## BILL-002: An Invoice Has No Proof

**Rule:** Nothing proves this.

**Owner:** `InvoiceDecider`

## BILL-003: An Invoice Has No Owner (replaces BILL-077)

**Rule:** Nothing enforces this.

**Proof:** `InvoiceDeciderTests`

## BILL-004 — A Heading Written Another Way

**Rule:** This entry isn't read as a rule.

**Owner:** `InvoiceDecider`

**Proof:** `InvoiceDeciderTests`
