// A test in an auto-import root, not an app-wide consumer: conditions.ts still has one owner.
import { isMet } from "~/shared/logic/conditions";
export const met = isMet(true);
