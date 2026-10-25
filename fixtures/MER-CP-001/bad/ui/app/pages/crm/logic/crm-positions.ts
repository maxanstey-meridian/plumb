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
export const exportable = { "acme-crm": true };
export const settingsLink = (tab: string) => `/settings/acme-crm/${tab}`;
export const connectorLink = (base: string) => `${base}/acme-connector`;
export const webhookLink = (base: string, tab: string) => `${base}/acme-webhook/${tab}`;
export enum CrmKind { Crm = "acme-crm" }
export const pickKind = (flag: boolean) => { const kind = flag ? "acme-crm" : null; return kind; };
export const pickedKind = (flag: boolean) => ({ kind: flag ? "acme-connector" : "other" });
export const fallbackHandler = (id: string | null) => { const handler = id ?? "acme-webhook"; return handler; };
export const orProbe = (id: string) => { const probe = id || "acme-probe"; return probe; };
export const CRM_SET = new Set(["acme-crm"]);
export const CRM_ACTIONS = new Map([["acme-connector", ["export"]]]);
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
export const choose = (kinds: string[], index: number) => { kinds[index] = "acme-crm"; };
export const flagged = (flag: boolean) => { const id = flag && "acme-crm"; return id; };
export const filled = (id?: string) => { let chosen = id; chosen ??= "acme-crm"; return chosen; };
export const panelFrom = (map: ReadonlyMap<string, string>) => map.get("acme-crm");
export const external = { externalCRMId: "acme-crm" };
export const variant = { abTestId: "acme-crm" };
export const chooseIn = (kinds: { value: string[] }) => { kinds.value[0] = "acme-crm"; };
export class CrmIds { static readonly CRM = "acme-crm"; }
export const routes = { "acme-crm": "acme-webhook" };
export const routeMap = new Map([["acme-connector", "acme-probe"]]);
export const routeKeys = { ["acme-connector"]: "acme-webhook" };
export const mimeShapedLink = (base: string) => `${base}text/acme-crm`;
declare const AcmeCrmPanel: object;
export const panels = { "acme-crm": AcmeCrmPanel };
export const settingsRoutes = { "acme-crm": "/settings/crm" };
export const settingsRouteMap = new Map([["acme-connector", "/settings/connector"]]);
export const tabRoutes = (tab: string) => ({ ["acme-webhook"]: `/settings/${tab}` });
// A label that equals a server id ("export") reads as an id-to-id map: the accepted trade-off, since route tables are the real harm.
export const formatLabels = new Map([["csv", "export"]]);
export const baseRoutes = (base: string) => ({ "acme-crm": `${base}/crm` });
declare const register: (routes: ReadonlyMap<string, string>) => void;
export const lazyRoutes = () => new Map([["acme-crm", "/settings/crm"]]);
register(new Map([["acme-connector", "acme-webhook"]]));
export const computedRoutes = computed(() => new Map([["acme-crm", "/settings/crm"]]));
export const relativeRoutes = { "acme-crm": "./settings/crm", "acme-connector": "../crm" };
export const joinedRoutes = (a: string, b: string) => ({ "acme-webhook": `${a}${b}/crm` });
export const connectUrls = { "acme-crm": "https://acme.example/connect", "acme-connector": "https://acme.zip" };
export const formatActions = { csv: "export", email: "acme-webhook" };
export const plainRoutes = { "acme-crm": `/settings/crm` };
export const constRoutes = new Map([["acme-crm", "acme-webhook" as const]]);
export const busyRoutes = (busy: boolean) => ({ "acme-crm": busy ? "Connecting" : "/settings/crm", "acme-connector": busy ? "/settings/connector" : "Connector" });
export const crmRoutes = Object.fromEntries([["acme-crm", "/settings/crm"], ["acme-connector", "acme-webhook"]]);
export const titleRoutes = (t: (key: string) => string) => ({ "acme-crm": t("crm.title") ?? "/settings/crm", "acme-connector": t("crm.connector") || "/settings/connector" });
export const docsRoutes = { "acme-crm": "/docs/crm/1.10" };
export const customRoutes = (t: (key: string) => string, route?: string) => ({ "acme-webhook": route ?? t("crm.webhook") });
export const profileRoutes = { "acme-crm": "/users/john.doe" };
export const actionLists = { csv: ["export"] };
export const busyActions = (busy: boolean) => ({ csv: busy ? "export" : "import" });
export const channelActions = (flag: boolean) => ({ email: flag ? "export" : "csv" });
export const fallbackActions = (action?: string) => ({ csv: action ?? ("export" as const) });
export const substitutedRoutes = (base: string, a: string, b: string) => ({ "acme-crm": `${base}`, "acme-connector": `${a}${b}` });
export const betaRoutes = (isBeta: boolean) => ({ "acme-crm": isBeta ? "Beta" : "acme-webhook", "acme-connector": isBeta ? undefined : "/settings/crm", "acme-probe": isBeta ? null : undefined });
export const relativeUrls = { "acme-crm": "//acme.zip" };
export const setRoutes = (routes: Map<string, string>) => routes.set("acme-crm", "acme-webhook");
export const indexRoutes = (routes: Record<string, string>) => { routes["acme-connector"] = "acme-probe"; };
type RouteTo = string | { path?: string; name?: string; params?: Record<string, string>; query?: Record<string, string> };
declare const router: { push: (to: RouteTo) => void; replace: (to: RouteTo) => void };
export const openCrm = () => navigateTo({ path: "/crm", query: { integration: "acme-crm" } });
export const openConnector = () => router.push("acme-connector");
export const openWebhook = () => router.replace({ path: "acme-webhook" });
export const openProbe = () => router.push({ name: "crm", params: { probe: "acme-probe" }, query: { integration: "acme-crm" } });
export const searchFor = (url: URL) => { url.searchParams.set("integration", "acme-crm"); url.searchParams.append("connector", "acme-connector"); };
export const objectQuery = () => new URLSearchParams({ target: "acme-webhook" }).toString();
export const entryQuery = () => new URLSearchParams([["probe", "acme-probe"]]);
export const stringQuery = () => new URLSearchParams("integration=acme-crm");
export const boundQuery = () => { const params = new URLSearchParams(); params.append("integration", "acme-connector"); return params; };
export const idQuery = (url: URL) => url.searchParams.set("csv", "export");
export const idEntryQuery = () => new URLSearchParams([["email", "acme-crm"]]);
export const fetchCrm = () => $fetch("/api/crm", { query: { integration: "acme-crm" } });
export const useCrm = () => useFetch("/api/crm", { query: { connector: "acme-connector" } });
export const fetchProbe = () => $fetch("/api/crm", { params: { probe: "acme-probe" } });
export const hashRoutes = { "acme-crm": "#/settings/crm" };
