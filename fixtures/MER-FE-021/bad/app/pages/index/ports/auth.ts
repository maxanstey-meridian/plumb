export interface Auth { login(): Promise<string> }
export const [injectAuth, provideAuth] = [0, 1] as const;
