// Consumed only by global route middleware, which runs on every route.
export const isPublicPath = (path: string) => path.startsWith("/public");
