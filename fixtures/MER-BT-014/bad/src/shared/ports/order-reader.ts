import type { Order } from "@/modules/orders/domain/order";

type InternalOrder = Order;

export interface OrderReader {
  find(id: string): Promise<InternalOrder | null>;
}

export { InternalOrder };
