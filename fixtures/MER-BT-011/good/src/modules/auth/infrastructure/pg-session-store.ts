import { SessionStore } from "../application/ports/session-store";
export class PgSessionStore implements SessionStore {
  async save(_id: string): Promise<void> {}
}
