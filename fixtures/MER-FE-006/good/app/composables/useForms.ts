import { formsClient } from "~~/generated/rivet/client";
export const useForms = () => {
  const create = async (name: string) => {
    const result = await formsClient.createForm({ name }, { unwrap: false });
    return result.isOk() ? result.value : null;
  };
  // §7 exception (use-rivet-auth.ts loginUrl): sync client helpers return no
  // result to narrow — only awaited calls are findings.
  const loginUrl = () => {
    try {
      return formsClient.loginUrl();
    } catch {
      return null;
    }
  };
  return { create, loginUrl };
};
