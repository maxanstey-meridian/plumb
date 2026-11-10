import { useProvideInject } from "../../shared/use-provide-inject";

export type Notes = { save(): void };

export const [injectNotes, provideNotes] = useProvideInject<Notes>("Notes");
