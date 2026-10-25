// Consumed only by named route middleware, which runs only where a page opts in.
export const loginPath = (path: string) => `/login?next=${path}`;
