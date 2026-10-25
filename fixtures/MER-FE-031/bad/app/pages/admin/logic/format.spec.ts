// A test of the shared item, not a consumer: format.ts still has one owner.
import { formatMoney } from "~/shared/logic/format";
export const formatted = formatMoney(1);
