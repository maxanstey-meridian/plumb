export type CrmDestinationDto = { integrationId: string | null };

export type CrmStatusDto = { connected: boolean };

export const integrationIds = ["acme-crm"] as const;

export const crmClient = {
  getDestination: async (): Promise<CrmDestinationDto> => ({ integrationId: null }),
};

export const api = {
  GET: async (path: "/api/integrations/acme-crm/status"): Promise<{ data: CrmStatusDto | undefined }> =>
    ({ data: path ? { connected: false } : undefined }),
};
