export interface InlineOrderReader {
  find(id: string): Promise<import("@/modules/orders/domain/order").Order | null>;
}
