// A Nuxt fixture app under tests/ is test code: its port may carry values a real port can't.
import { useProvideInject } from "~/composables/useProvideInject";

export interface Auth {
    login: () => Promise<void>;
}

export const fakeAuth: Auth = { login: async () => {} };

export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
