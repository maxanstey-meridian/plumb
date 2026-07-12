import { PgSessionStore } from "../infrastructure/pg-session-store";
import { PgSessionStore as AliasStore } from "@/modules/auth/infrastructure/pg-session-store";
import { Controller } from "@nestjs/common";
import { LoginController } from "@/modules/auth/interface/http/login-controller";
import type { WireRequest } from "@acme/generated-transport";
export const login = () => new PgSessionStore();
