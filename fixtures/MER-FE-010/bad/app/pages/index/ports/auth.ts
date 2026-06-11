import type { Ref } from "vue";
import { rivetFetch } from "../adapters/client";

import { useProvideInject } from "~/composables/useProvideInject";

export interface Auth {
    isLoading: Ref<boolean>;
    login: () => Promise<void>;
}

export function buildLoginUrl(base: string): string {
    return `${base}/login`;
}

export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");

export const DEFAULT_TIMEOUT = 5000;
