import { spawnSync } from "node:child_process";
import { createRepositoryInventory, writeInventoryManifest } from "../../lib/repository-inventory.mjs";

export function spawnProducer(file, root, options = {}) {
  const inventory = createRepositoryInventory(root);
  const manifest = writeInventoryManifest(inventory);
  const { env = {}, ...spawnOptions } = options;
  try {
    return spawnSync(file, [inventory.root], {
      ...spawnOptions,
      env: {
        ...process.env,
        ...env,
        PLUMB_FILE_MANIFEST: manifest.file,
        PLUMB_REPO_ROOT: inventory.root,
      },
    });
  } finally {
    manifest.cleanup();
  }
}
