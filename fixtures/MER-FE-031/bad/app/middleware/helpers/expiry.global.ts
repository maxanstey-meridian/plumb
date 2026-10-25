// Nuxt registers only top-level middleware and middleware/<dir>/index.*, so this is a plain module, not global.
import { isExpired } from "~/shared/logic/expiry";
export default (at: number) => isExpired(at);
