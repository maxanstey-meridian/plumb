export interface Auth { login(): Promise<string> }
// injectSuperAuth is documentation, not an exported port tuple.
export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
