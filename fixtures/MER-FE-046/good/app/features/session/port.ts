import { useProvideInject as createPort } from "../../shared/use-provide-inject";

export type Session = { userId: string };

export const [injectSession, provideSession] = createPort<Session>("Session");
