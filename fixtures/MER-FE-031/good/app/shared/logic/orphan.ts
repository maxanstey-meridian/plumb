// §7 exception: zero-consumer shared files are not flagged — Nuxt auto-imports
// make absence-of-import unprovable.
export const orphanRule = (n: number) => n > 0;
