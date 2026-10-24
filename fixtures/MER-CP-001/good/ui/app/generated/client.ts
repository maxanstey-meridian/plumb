export type CrmDestinationDto = { integrationId: string | null };

export const integrationIds = ["acme-crm"] as const;

export const crmClient = {
  getDestination: async (): Promise<CrmDestinationDto> => ({ integrationId: null }),
};
