import { Injectable } from "@nestjs/common";
import { startSession } from "../application/start-session";
export const sessionRule = (s: string) => s.length > 0;
