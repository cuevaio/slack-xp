import { expect, test } from "@playwright/test";

test("Observer sees a non-live teaser and can enter the office", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Your coworkers are online/ }),
  ).toBeVisible();
  await expect(page.getByText("0 LIVE CONNECTIONS")).toBeVisible();
  await expect(page.getByText(/MOCK SERVICES/)).toHaveCount(0);

  await page
    .getByRole("link", { name: "Enter the Shared Public Office" })
    .click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByText("MOCK SERVICES - NO LIVE DATA")).toBeVisible();
  await expect(page.getByText("Welcome, Pat Pending")).toBeVisible();
});

test("mock office remains usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/office");

  await expect(page.getByText("Shared Public Office")).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
});
