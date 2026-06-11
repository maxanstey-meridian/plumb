import { client } from "@acme/contracts";
export const useNotes = () => {
  const load = async () => {
    // (a) data bound without error — HTTP failures silently become undefined
    const { data } = await client.GET("/api/notes");
    return data;
  };
  const peek = async () =>
    // (b) direct .data access on the awaited call
    (await client.GET("/api/notes")).data;
  return { load, peek };
};
