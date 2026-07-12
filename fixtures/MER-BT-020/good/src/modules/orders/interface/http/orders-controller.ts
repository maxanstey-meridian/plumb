import { listOrders } from "@/modules/orders/application/list-orders";
import type { OrderSummary } from "@/modules/orders/application/contracts/order-summary";

export const getOrders = (): OrderSummary[] => listOrders();
