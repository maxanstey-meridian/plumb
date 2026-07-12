import { SessionStore } from "./ports/session-store";
import { SessionStore as AliasStore } from "@/modules/auth/application/ports/session-store";
import pino from "pino";
import { createInjector } from "typed-inject";
import type { MissingButSilent } from "@/unresolved/application-contract";
export const login = (store: SessionStore) => store.save("s");
