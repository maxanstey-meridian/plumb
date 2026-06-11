import { client } from "@acme/contracts";
export const useNotes = () => {
  // golden style: capture the result, narrow on result?.data truthiness
  // (data/error are mutually exclusive); .catch covers transport failure
  const load = async () => {
    const result = await client.GET("/api/notes").catch(() => null);
    return result?.data ?? null;
  };
  // destructuring is fine when error is bound too
  const create = async () => {
    const { data, error } = await client.POST("/api/notes", { body: { title: "x" } });
    return error ? null : data;
  };
  return { load, create };
};
