// The same words as the server's ids, used as wording: presentation, not a copy.
const pluralise = (count: number, noun: string) => (count === 1 ? noun : `${noun}s`);

export const crmCopy = { noun: "acme-crm", subject: "acme-connector", title: "Acme CRM" };
export const describe = (count: number) => pluralise(count, "acme-crm");
export const heading = () => "acme-webhook";
