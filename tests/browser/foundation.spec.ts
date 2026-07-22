import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/auth/mock-onboarding/reset");
  expect(response.status()).toBe(204);
});

test("Observer completes first entry and returning entry bypasses setup", async ({
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
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Foffice$/);
  await expect(page.getByText("MOCK AUTHENTICATION - TEST ONLY")).toBeVisible();

  await page.getByRole("button", { name: "Sign in as New Hire" }).click();
  await expect(page).toHaveURL(/\/office$/);
  await expect(
    page.getByRole("heading", { name: "Confirm your Employee Record" }),
  ).toBeVisible();

  const assignedTitle = await page
    .locator(".assignment-card strong")
    .textContent();
  await page.getByLabel("First name").fill("Patricia");
  await page.getByRole("button", { name: "Save Employee Record" }).click();

  await expect(
    page.getByRole("heading", { name: "Review the Code of Conduct" }),
  ).toBeVisible();
  await expect(page.locator(".assignment-card strong")).toHaveText(
    assignedTitle ?? "",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review the Code of Conduct" }),
  ).toBeVisible();
  await expect(page.locator(".assignment-card strong")).toHaveText(
    assignedTitle ?? "",
  );

  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Accept and Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Your desk is almost ready" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "CLOCK IN" }).click();

  await expect(page.getByText("Welcome, Patricia Pending")).toBeVisible();
  await expect(page.getByText(assignedTitle ?? "")).toBeVisible();

  const retry = await page.request.post("/api/office/onboarding", {
    form: { intent: "clock-in" },
  });
  expect(retry.status()).toBe(200);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as New Hire" }).click();
  await expect(page.getByText("Welcome, Patricia Pending")).toBeVisible();
  await expect(page.getByText("New Employee Setup Wizard")).toHaveCount(0);
});

test("server boundaries reject invalid setup and forged identity", async ({
  page,
}) => {
  const forgedResponse = await page.request.get("/api/office/session", {
    headers: { "x-clerk-user-id": "user_mock_operator" },
  });
  expect(forgedResponse.status()).toBe(401);

  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as New Hire" }).click();

  const invalidProfile = await page.request.post("/api/office/onboarding", {
    form: { intent: "confirm-profile", firstName: "", lastName: "" },
  });
  expect(invalidProfile.status()).toBe(422);

  const earlyClockIn = await page.request.post("/api/office/onboarding", {
    form: { intent: "clock-in" },
  });
  expect(earlyClockIn.status()).toBe(422);
  expect(await earlyClockIn.json()).toMatchObject({
    error: "onboarding_incomplete",
  });

  const authenticatedResponse = await page.request.get("/api/office/session");
  expect(authenticatedResponse.status()).toBe(200);
  expect(await authenticatedResponse.json()).toMatchObject({
    id: "user_mock_new_hire",
    isOperator: false,
  });

  await page.request.post("/api/auth/sign-out");
  expect((await page.request.get("/api/office/session")).status()).toBe(401);
});

test("interrupted setup resumes and the returning fixture enters the Office Day", async ({
  page,
}) => {
  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as New Hire" }).click();
  await page.getByRole("button", { name: "Save Employee Record" }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Review the Code of Conduct" }),
  ).toBeVisible();

  await page.request.post("/api/auth/sign-out");
  await page.goto("/sign-in");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(page.getByText("Welcome, Terry Byte")).toBeVisible();
  await expect(page.getByText("New Employee Setup Wizard")).toHaveCount(0);
});

test("completed mock office remains usable at a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();

  await expect(page.getByText("Shared Public Office")).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
});
