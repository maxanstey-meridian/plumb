import { invoiceRule } from "../../billing/domain/invoice";
import { invoiceRule as aliasRule } from "@/modules/billing/domain/invoice";
export const grant = () => invoiceRule("x");
