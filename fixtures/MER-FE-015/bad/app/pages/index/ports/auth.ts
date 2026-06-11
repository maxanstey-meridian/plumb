import { useProvideInject } from "~/composables/useProvideInject";

export interface AuthApi {
    login: () => Promise<void>;
    logout: () => Promise<void>;
    refresh: () => Promise<void>;
}

export const [injectAuthApi, provideAuthApi] = useProvideInject<AuthApi>("AuthApi");
