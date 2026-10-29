# Billing Invariants

## BILL-001: A Paid Invoice Never Changes

**Rule:** Once an invoice is paid, nothing about it changes (see BILL-009).

**Owner:** `InvoiceDecider.Removed`; `GoneService`; `Modules/Gone/`

**Proof:** `GoneTests`; `InvoiceDeciderTests.A_deleted_test`; `Gone.feature`; `gone.spec.ts`

## BILL-002: An Invoice Has No Proof

**Rule:** Nothing proves this.

**Owner:** `InvoiceDecider`

## BILL-003: An Invoice Has No Owner

**Rule:** Nothing enforces this.

**Proof:** `InvoiceDeciderTests`
