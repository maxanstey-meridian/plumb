export const submittedNow = () => new Date();
export const formattedNow = () => Date();
export const globalNow = () => globalThis.Date.now();
export const preciseNow = () => Temporal.Now.instant();
