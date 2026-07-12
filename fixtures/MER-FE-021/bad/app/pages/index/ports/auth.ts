export interface Auth { login(): Promise<string> }
export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
