import { BillingCheck } from "../../common/application/ports/billing-check";
import type { InvoiceSummary } from "../../billing/contracts/invoice-summary";
import type { InvoiceSummary as AliasSummary } from "@/modules/billing/contracts/invoice-summary";
export const grant = (check: BillingCheck, invoice: InvoiceSummary) =>
  check.allowed(invoice.id);
