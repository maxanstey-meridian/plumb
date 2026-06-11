import { sessionId } from "./session-id";
export const sessionRule = (s: string) => sessionId(s).length > 0;
