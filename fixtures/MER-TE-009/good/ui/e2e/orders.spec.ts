import { test } from "@playwright/test";
import type { components } from "@app/contracts/schema";

type OrderDto = components["schemas"]["OrderDto"];
const order = (): OrderDto => ({ id: "1", reference: "A1" });

test("lists orders", async ({ page }) => {
  await page.route("**/api/orders", async (route) => {
    await route.fulfill({ status: 200, body: JSON.stringify([{ id: "1", reference: "A1" }] satisfies OrderDto[]) });
  });
  await page.route("**/api/orders/1", (route) => route.fulfill({ json: order() }));
});
