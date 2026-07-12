export interface OrderStore {
  save(id: string): Promise<void>;
}
