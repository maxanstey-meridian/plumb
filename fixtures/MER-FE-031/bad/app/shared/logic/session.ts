// Consumed only by middleware/<dir>/index.global.ts, which Nuxt never registers as global (only middleware/<name>.global.*).
export const hasSession = (token: string) => token.length > 0;
