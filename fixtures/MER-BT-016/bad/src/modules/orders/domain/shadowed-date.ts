export function localDate() {
  class Date { static now() { return 0; } }
  return [Date.now(), globalThis.Date.now()];
}

export const unrelatedNow = () => Date.now();
