export function localProcess(process: { env: Record<string, string> }) {
  return process.env.LOCAL;
}

export const ambientProcess = process.env.AMBIENT;

export function localGlobal(globalThis: { process: { env: Record<string, string> } }) {
  return globalThis.process.env.LOCAL;
}

export const ambientGlobal = globalThis.process.env.AMBIENT;
