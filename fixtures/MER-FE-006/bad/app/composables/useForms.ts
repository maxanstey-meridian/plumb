import { formsClient } from "~~/generated/rivet/client";
export const useForms = () => {
  const create = async (name: string) => {
    try {
      return await formsClient.createForm({ name });
    } catch (error) {
      return null;
    }
  };
  return { create };
};
