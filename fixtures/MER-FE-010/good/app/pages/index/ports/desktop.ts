// §7 exceptions (speechscribe shared/ports/desktop.ts): declare-modified ambient
// statements and hand-written injectX helpers are legal port content.
import type { Ref } from "vue";

declare global {
  interface Window {
    __desktopHost?: { open: (path: string) => Promise<void> };
  }
}

export interface Desktop {
  ready: Ref<boolean>;
  open: (path: string) => Promise<void>;
}

export const injectDesktop = (): Desktop => {
  return window.__desktopHost as unknown as Desktop;
};
