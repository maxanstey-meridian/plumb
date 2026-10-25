import { hasSession } from "~/shared/logic/session";
export default (token: string) => hasSession(token);
