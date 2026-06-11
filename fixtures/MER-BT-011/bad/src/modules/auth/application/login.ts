import { PgSessionStore } from "../infrastructure/pg-session-store";
export const login = () => new PgSessionStore();
