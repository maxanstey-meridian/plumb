import { BillingCheck } from "../../common/application/ports/billing-check";
export const grant = (check: BillingCheck) => check.allowed("x");
