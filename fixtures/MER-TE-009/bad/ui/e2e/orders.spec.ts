import { test } from "@playwright/test";

test("lists orders", async ({ page }) => {
  await page.route("**/api/orders", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ id: "1" }]) });
  });
  await page.route("**/api/orders/1", (route) => route.fulfill({ json: { id: "1" } }));
});
