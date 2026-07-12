import type { Order } from "@/modules/orders/domain/order";

export class OrderCache {
  private cached: Order | null = null;

  put(order: Order): void {
    this.cached = order;
  }
}
