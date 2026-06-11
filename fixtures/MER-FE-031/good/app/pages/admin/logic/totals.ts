import { formatMoney } from "~/shared/logic/format";
export const total = (xs: number[]) => formatMoney(xs.reduce((a, b) => a + b, 0));
