// Consumed only by a nested middleware module, which Nuxt never registers as global middleware.
export const isExpired = (at: number) => at < 0;
