export interface OrderRepository {
  save(id: string): Promise<void>;
}

export const submitOrder = (repository: OrderRepository, id: string) => repository.save(id);
