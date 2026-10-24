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
// Labels, colours, icons and orderings keyed on a server id are presentation (string values only).
export const integrationLabels = { "acme-crm": "Acme CRM" };
export const integrationColours = { ["acme-crm"]: "primary" } as const;
export const integrationIcons = new Map([["acme-crm", "i-lucide-plug"]]);
export const integrationTitles = new Map([["acme-crm", "Acme CRM"] as const]);
export const integrationNames = (name: string) => ({ "acme-crm": `${name} CRM` });
export const integrationOrder = { "acme-crm": "first" as const } satisfies Record<string, string>;
export const integrationRank = { "acme-crm": <const>"first" };
export const integrationShortNames = new Map([["acme-crm", <string>"Acme"]]);
export const formatNames = { "csv": "Spreadsheet" };
export const formatHints = new Map([["csv", "Opens in a spreadsheet"]]);
// Wording across a whole template literal, and MIME types whose subtype equals the server's "csv" id.
export const exportPrompt = (mode: string) => `Choose ${mode}/export`;
export const csvType = "text/csv";
export const csvTypeFor = (header: boolean) => `text/csv${header ? ";header=present" : ""}`;
