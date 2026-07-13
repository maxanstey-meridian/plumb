import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectRivetContext } from "../../lib/rivet-context.mjs";
import { createManifestRepositoryView } from "./fs-scan.mjs";

export const detectRivetVariant = detectRivetContext;

export function rivetVariant(repository) {
  const value = process.env.PLUMB_RIVET_VARIANT;
  return ["v1", "v2", "both", "none"].includes(value) ? value : detectRivetContext(repository).variant;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(detectRivetContext(createManifestRepositoryView(process.argv[2])).variant);
}
