// Wording that happens to equal the server's "export" id: presentation, not a copy.
const pluralise = (count: number, noun: string) => (count === 1 ? noun : `${noun}s`);

export const crmCopy = { noun: "export", subject: "export", title: "export", typeLabel: "export", description: "Choose import/export" };
export const describe = (count: number) => pluralise(count, "export");
export const heading = () => "export";
export const caption = (busy: boolean) => pluralise(2, busy ? "export" : "import");
export const formatLabels = new Map([["pdf", "export"]]);
export const formatTitles = new Map([["pdf", "export"] as const]);
export const relabel = (labels: string[], index: number) => { labels[index] = "export"; };
export const relabelKind = (labelsByKind: Record<string, string>, kind: string) => { labelsByKind[kind] = "export"; };
export class ExportDialog {
  title = "export";
  open() {
    this.title = "export";
  }
}
// String labels, colours and icons keyed on a server id are presentation; a numeric value, an ordering or a limit,
// is flagged (the bad fixture's crm-positions.ts:36).
export const integrationLabels = { "acme-crm": "Acme CRM" };
export const integrationColours = { ["acme-crm"]: "primary" } as const;
export const integrationIcons = new Map([["acme-crm", "i-lucide-plug"]]);
export const integrationTitles = new Map([["acme-crm", "Acme CRM"] as const]);
export const integrationNames = (name: string) => ({ "acme-crm": `${name} CRM` });
export const integrationTones = { "acme-crm": "neutral" as const } satisfies Record<string, string>;
export const integrationBadges = { "acme-crm": <const>"Beta" };
export const integrationShortNames = new Map([["acme-crm", <string>"Acme"]]);
export const formatNames = { "csv": "Spreadsheet" };
export const formatHints = new Map([["csv", "Opens in a spreadsheet"]]);
// A `/` in wording isn't a route: only a value starting with `/` (or `${…}/`) maps an id to one.
export const integrationAccess = { "acme-crm": "Read/Write" };
export const integrationAccessLabels = new Map([["acme-crm", "Read/Write"]]);
// A component's name as a string is a label; dispatch on the imported component is flagged (crm-positions.ts:56).
export const integrationPanelNames = { "acme-crm": "AcmeCrmPanel" };
// Wording across a whole template literal, and MIME types whose subtype equals the server's "csv" id.
export const exportPrompt = (mode: string) => `Choose ${mode}/export`;
export const csvType = "text/csv";
export const csvTypeFor = (header: boolean) => `text/csv${header ? ";header=present" : ""}`;
// An asset is presentation, by its web asset extension (even "csv", a server id): a logo is an icon, also at a URL.
export const integrationLogos = { "acme-crm": "/logos/acme.svg" };
export const integrationLogoMap = new Map([["acme-crm", "/logos/acme.svg?v=2"]]);
export const integrationLogoAt = (base: string) => ({ "acme-crm": `${base}/acme.png` });
export const integrationCdnLogos = { "acme-crm": "https://cdn.example/acme.svg" };
export const integrationExports = { "acme-crm": "/exports/acme.csv" };
// A choice between labels, and a translation, are labels; unquoted keys are field names unless both sides are ids.
export const integrationStatus = (busy: boolean) => ({ "acme-crm": busy ? "Connecting" : "Acme CRM" });
export const integrationCaptions = (t: (key: string) => string) => ({ "acme-crm": t("acme"), "csv": t("csv") ?? "Spreadsheet" });
export const formatCaptions = (i18n: { t: (key: string) => string }) => ({ "csv": i18n.t("format.csv") });
export const formatFlags = { email: true, csv: "Comma separated" };
