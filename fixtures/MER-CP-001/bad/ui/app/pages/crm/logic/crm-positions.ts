import type { CrmDestinationDto } from "~/generated/client";

export const isNotCrm = (destination: CrmDestinationDto) => destination.integrationId !== "acme-crm";
export const isCrmLoosely = (destination: CrmDestinationDto) => destination.integrationId == "acme-crm";
export const isNotConnector = (destination: CrmDestinationDto) => destination.connectorId != "acme-connector";
export const panelFor = (destination: CrmDestinationDto) => {
  switch (destination.handlerId) {
    case "acme-webhook":
      return "webhook";
    default:
      return null;
  }
};
export const known = (ids: readonly string[], set: ReadonlySet<string>) =>
  ids.includes("acme-crm") || set.has("acme-connector") || ids.indexOf("acme-webhook") >= 0;
export const isListed = (id: string) => ["acme-crm", "acme-connector"].includes(id);
export const listedAt = (id: string) => ["acme-webhook"].indexOf(id);
export const CRM_HANDLERS = ["acme-webhook"] as const;
export const CRM_ID = "acme-crm" as const;
export const destination = { handlerId: "acme-webhook", kind: "acme-connector" };
export const panels = { "acme-crm": "AcmeCrmPanel" };
export const settingsLink = (tab: string) => `/settings/acme-crm/${tab}`;
export const connectorLink = (base: string) => `${base}/acme-connector`;
export const webhookLink = (base: string, tab: string) => `${base}/acme-webhook/${tab}`;
