import type { OrderSummary } from "@/modules/orders/contracts/order-summary";

export interface OrderReader {
  find(id: string): Promise<OrderSummary | null>;
}
