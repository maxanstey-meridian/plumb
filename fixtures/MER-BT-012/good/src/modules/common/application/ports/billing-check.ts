export abstract class BillingCheck {
  private constructor() {}
  abstract allowed(id: string): Promise<boolean>;
}
