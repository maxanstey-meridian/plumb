import { useProvideInject } from "../../../shared/use-provide-inject";

export type Auth = { signOut(): void };

export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
