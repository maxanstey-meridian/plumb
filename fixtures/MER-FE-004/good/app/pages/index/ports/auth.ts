import { useProvideInject } from "~/shared/composables/use-provide-inject";
import { canLogin } from "../logic/auth-rules";
export interface Auth { login(): Promise<string>; can: typeof canLogin }
export const [injectAuth, provideAuth] = useProvideInject<Auth>("Auth");
