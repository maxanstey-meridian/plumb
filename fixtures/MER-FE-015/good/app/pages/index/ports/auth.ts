import type { Ref } from "vue";

import { useProvideInject } from "~/composables/useProvideInject";

export interface Auth {
    isLoading: Ref<boolean>;
    errorMessage: Ref<string | null>;
    login: () => Promise<void>;
    signOutEverywhere: () => Promise<void>;
}

export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
