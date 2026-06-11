export interface Auth { load: () => Promise<void> }
export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
