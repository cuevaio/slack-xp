import { expect, test } from "@playwright/test";

test("Observer keeps a non-live desktop teaser local and keyboard-accessible", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Your coworkers are online/ }),
  ).toBeVisible();
  await expect(page.getByText("0 LIVE CONNECTIONS")).toBeVisible();
  await expect(page.getByText(/MOCK SERVICES/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open Start menu" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Minimize observer preview window" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Open Start menu" }).click();
  await expect(page.getByRole("menu", { name: "Start menu" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open Start menu" }),
  ).toBeFocused();
  await expect(
    page.getByRole("menu", { name: "Start menu" }),
  ).not.toBeVisible();

  await page.getByRole("button", { name: "Open Start menu" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "Start menu" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter the Shared Public Office" }),
  ).toBeFocused();

  await page
    .getByRole("button", { name: "Minimize observer preview window" })
    .click();
  await expect(page.getByText("Preview window minimized")).toBeVisible();
  await page
    .getByRole("button", { name: "Restore observer preview window" })
    .click();
  await expect(
    page.getByRole("region", { name: "Non-live product preview" }),
  ).toBeVisible();

  await page
    .getByRole("link", { name: "Enter the Shared Public Office" })
    .click();
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Foffice$/);
  await expect(page.getByText("MOCK AUTHENTICATION - TEST ONLY")).toBeVisible();
  await expect(page.getByText(/MOCK SERVICES/)).toHaveCount(0);

  await page.getByRole("button", { name: "Sign in as New Hire" }).click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(page.getByText("MOCK SERVICES - NO LIVE DATA")).toBeVisible();
  await expect(page.getByText("Welcome, Pat Pending")).toBeVisible();
  expect(requests.filter((url) => /portal|clerk/i.test(url))).toHaveLength(0);
});

test("Observer mobile teaser keeps sign-in reachable without desktop-only interactions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /Clock in from your pocket/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter the Shared Public Office" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Start menu" }),
  ).toHaveCount(0);

  await page
    .getByRole("link", { name: "Enter the Shared Public Office" })
    .click();
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Foffice$/);
});

test("server operations reject forged identity and session loss", async ({
  page,
}) => {
  const forgedResponse = await page.request.get("/api/office/session", {
    headers: { "x-clerk-user-id": "user_mock_operator" },
  });
  expect(forgedResponse.status()).toBe(401);

  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as New Hire" }).click();

  const authenticatedResponse = await page.request.get("/api/office/session");
  expect(authenticatedResponse.status()).toBe(200);
  expect(await authenticatedResponse.json()).toMatchObject({
    id: "user_mock_new_hire",
    isOperator: false,
  });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  expect((await page.request.get("/api/office/session")).status()).toBe(401);

  await page.goto("/office");
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Foffice$/);
});

test("mock office remains usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as New Hire" }).click();

  await expect(page.getByText("Shared Public Office")).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
});
