import { SessionStore } from "./ports/session-store";
export const login = (store: SessionStore) => store.save("s");
