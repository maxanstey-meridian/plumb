export abstract class SessionStore {
  private constructor() {}
  abstract save(id: string): Promise<void>;
}
