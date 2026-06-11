// composables MAY import the contracts client — the rule scopes to components
import { client } from "@acme/contracts";
export const useNotes = () => ({ load: () => client.GET("/api/notes") });
