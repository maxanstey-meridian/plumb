import type { Ref } from "vue";
import { type CurrentUserDto } from "../logic/session";

import { useProvideInject } from "~/composables/useProvideInject";

export interface Auth {
    currentUser: Ref<CurrentUserDto | null>;
    isLoading: Ref<boolean>;
    login: () => Promise<void>;
    logout: () => Promise<void>;
}

export type AuthState = "anonymous" | "authenticated";

export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
