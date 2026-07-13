import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FALLBACK_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".nuxt",
  ".output",
  "dist",
  "build",
  "vendor",
  "obj",
  "bin",
  ".turbo",
  "coverage",
]);

const posix = (value) => value.split(path.sep).join("/");

function gitInventory(root) {
  const probe = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (probe.error?.code === "ENOENT") return null;
  if (probe.error) throw new Error(`git repository probe failed: ${probe.error.message}`);
  if (probe.status !== 0) {
    if (/not a git repository/i.test(probe.stderr || "")) return null;
    throw new Error(`git repository probe failed: ${probe.stderr.trim() || `exit ${probe.status}`}`);
  }

  const repositoryRoot = path.resolve(probe.stdout.trim());
  const scanRoot = posix(path.relative(repositoryRoot, root));
  const listed = spawnSync("git", ["-C", repositoryRoot, "ls-files", "-co", "--exclude-standard", "--full-name", "-z"], {
    maxBuffer: 128 * 1024 * 1024,
  });
  if (listed.error || listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.error?.message || listed.stderr?.toString("utf8").trim() || `exit ${listed.status}`}`);
  }

  const files = listed.stdout.toString("utf8").split("\0").filter(Boolean).flatMap((file) => {
    let relative = file;
    if (scanRoot) {
      if (!file.startsWith(`${scanRoot}/`)) return [];
      relative = file.slice(scanRoot.length + 1);
    }
    try {
      const entry = fs.lstatSync(path.resolve(root, ...relative.split("/")));
      return entry.isFile() ? [relative] : [];
    } catch {
      return [];
    }
  });
  return { mode: "git", files };
}

function fallbackInventory(root) {
  const files = [];
  const visit = (directory, relativeDirectory) => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!FALLBACK_SKIP_DIRS.has(entry.name)) visit(absolute, relative);
      } else if (entry.isFile()) {
        files.push(relative);
      }
    }
  };
  visit(root, "");
  return { mode: "fallback", files };
}

export function createRepositoryInventory(targetRoot) {
  const root = fs.realpathSync(path.resolve(targetRoot));
  const discovered = gitInventory(root) ?? fallbackInventory(root);
  const files = [...new Set(discovered.files.map(posix))].sort();
  return Object.freeze({ root, mode: discovered.mode, files: Object.freeze(files) });
}

export function writeInventoryManifest(inventory) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-manifest-"));
  const file = path.join(directory, "files");
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    fs.rmSync(directory, { recursive: true, force: true });
  };
  try {
    const payload = inventory.files.length ? `${inventory.files.join("\0")}\0` : "";
    fs.writeFileSync(file, payload, { mode: 0o400 });
    fs.chmodSync(file, 0o400);
    return { file, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
