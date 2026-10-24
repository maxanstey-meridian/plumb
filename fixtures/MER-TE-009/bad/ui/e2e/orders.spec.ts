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

test("patches with a name that isn't the real body", async ({ page }) => {
  await page.route("**/api/orders/5", async (route) => {
    const response = await route.fetch();
    const body = { id: "5" };
    await route.fulfill({ response, json: { ...body, flagged: true } });
  });
  await page.route("**/api/orders/6", async (route) => {
    const response = await route.fetch();
    let real = await response.json();
    real = { id: "6" };
    await route.fulfill({ response, json: { ...real, flagged: true } });
  });
});

test("reads the real body under the same name elsewhere", async ({ page }) => {
  await page.route("**/api/orders/7", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, flagged: true } });
  });
});
