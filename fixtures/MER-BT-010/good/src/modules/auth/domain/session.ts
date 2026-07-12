import { sessionId } from "./session-id";
import { sessionId as aliasSessionId } from "@/modules/auth/domain/session-id";
import { EntityId } from "@/modules/common/domain/entity-id";
export const sessionRule = (s: string) => sessionId(s).length > 0;
