import type { ClientOptions } from "openapi-fetch";
const createOpenApiClient = (_options: ClientOptions) => ({ local: true });
export const useLocalClient = () => createOpenApiClient({});
