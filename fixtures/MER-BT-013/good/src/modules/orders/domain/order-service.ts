export class OrderService {
  canSubmit(id: string): boolean {
    return id.length > 0;
  }
}
