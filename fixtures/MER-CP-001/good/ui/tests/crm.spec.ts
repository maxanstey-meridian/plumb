import { expect, it } from "vitest";

it("links to the CRM settings", () => {
  expect(`/settings/integrations/acme-crm`).toContain("acme-crm");
});
