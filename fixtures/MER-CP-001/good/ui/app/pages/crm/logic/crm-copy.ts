// Wording that happens to equal the server's "export" id: presentation, not a copy.
const pluralise = (count: number, noun: string) => (count === 1 ? noun : `${noun}s`);

export const crmCopy = { noun: "export", subject: "export", title: "export", typeLabel: "export", description: "Choose import/export" };
export const describe = (count: number) => pluralise(count, "export");
export const heading = () => "export";
export const caption = (busy: boolean) => pluralise(2, busy ? "export" : "import");
