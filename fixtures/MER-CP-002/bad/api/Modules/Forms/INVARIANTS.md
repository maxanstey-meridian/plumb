# Forms Invariants

## FORM-001 — A Form Is Submitted Once

**Rule:** A submitted form never takes a second submission. A dash after the ID still heads a rule, so its names are checked. It leans on FORM-009 (FORM-009 is cited twice, and reported once).

**Owner:** `FormSubmitter`, and nothing but `FormSubmitter`, which is cited twice and reported once

**Proof:** `InvoiceDeciderTests`

## FORM-D-001 A Form Draft Is Kept

**Rule:** A listed word (D) in the middle of an ID doesn't make a heading prose, so its names are checked.

**Owner:** `FormDGone`

**Proof:** `InvoiceDeciderTests`
