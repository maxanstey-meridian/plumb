import { OrderRepository } from "@/modules/orders/infrastructure/order-repository";

export class OrdersController {
  constructor(private readonly orders: OrderRepository) {}
}
