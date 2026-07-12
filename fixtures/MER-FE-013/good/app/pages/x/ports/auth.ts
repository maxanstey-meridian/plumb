export interface Auth { login(): Promise<void> }
export type Profile = { load(): Promise<void> };
