import { test } from "@playwright/test";
import type { components } from "@app/contracts/schema";

type OrderDto = components["schemas"]["OrderDto"];

test("lists orders", async ({ page }) => {
  await page.route("**/api/orders", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "1" }]) });
  });
  await page.route("**/api/orders/1", (route) => route.fulfill({ json: { id: "1" } }));
  await page.route("**/api/orders/2", (route) => route.fulfill({ json: { id: "2" } as const }));
  await page.route("**/api/orders/3", (route) => route.fulfill({ body: JSON.stringify({ id: "3" } as OrderDto) }));
  await page.route("**/api/orders/4", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { id: "4" } });
  });
});
