// §7 exception (confer): with nuxt.config at a workspace root, sibling
// packages' test dirs are BE-TS territory, not colocated frontend tests.
import { describe, it } from "vitest";
describe("contract", () => { it("holds", () => {}); });
