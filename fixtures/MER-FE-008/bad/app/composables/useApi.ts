import createClient from "openapi-fetch";
export const useApi = () => createClient({ baseUrl: "/api" });
