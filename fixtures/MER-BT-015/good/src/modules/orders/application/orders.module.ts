export const buildOrders = (container: { resolve(name: string): unknown }) =>
  container.resolve("OrderRepository");
