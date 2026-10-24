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
export enum CrmKind { Crm = "acme-crm" }
export const pickKind = (flag: boolean) => { const kind = flag ? "acme-crm" : null; return kind; };
export const pickedKind = (flag: boolean) => ({ kind: flag ? "acme-connector" : "other" });
export const fallbackHandler = (id: string | null) => { const handler = id ?? "acme-webhook"; return handler; };
export const orProbe = (id: string) => { const probe = id || "acme-probe"; return probe; };
export const CRM_SET = new Set(["acme-crm"]);
export const CRM_PANELS = new Map([["acme-connector", "ConnectorPanel"]]);
export const inSet = (id: string) => new Set(["acme-probe"]).has(id);
export const handlers = { handlerIds: ["acme-webhook"] };
export const select = (state: { handlerId: string }) => { state.handlerId = "acme-webhook"; };
export const panelOf = (map: Record<string, string>) => map["acme-crm"];
export const computedKey = { ["acme-connector"]: 1 };
export const computedIdName = { ["handlerId"]: "acme-webhook" };
export const hasCrm = (map: object) => "acme-crm" in map;
export const openWith = (kind = "acme-webhook") => kind;
export const openFrom = ({ kind = "acme-connector" }: { kind?: string }) => kind;
export class CrmPanel { readonly kind = "acme-crm"; }
export const asserted = <string>"acme-probe";
