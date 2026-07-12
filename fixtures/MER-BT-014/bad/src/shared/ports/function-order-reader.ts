import type { Order } from "../../modules/orders/domain/order";

export function readOrder(order: Order): Promise<Order> {
  throw new Error("port contract only");
}

export const writeOrder: (order: Order) => Promise<void> = async () => {};
