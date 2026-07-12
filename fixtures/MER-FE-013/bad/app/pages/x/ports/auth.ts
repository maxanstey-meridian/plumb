export interface AuthService { login(): Promise<void> }
export type ProfileDto = { name: string };
export interface CurrentUserDtoPort { load(): Promise<void> }
interface InternalHelper { run(): void }
interface BillingService { charge(): Promise<void> }
export { BillingService };
