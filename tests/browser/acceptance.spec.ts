import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { MOCK_OFFICE_FAULT_HEADER } from "@/lib/portal/request-time";

async function expectNoWcagViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function expectVisibleButtonTouchTargets(page: Page) {
  const undersized = await page
    .locator("main button:not(:disabled)")
    .evaluateAll((buttons) =>
      buttons
        .filter((button) => button.checkVisibility())
        .map((button) => {
          const bounds = button.getBoundingClientRect();
          return {
            name: button.getAttribute("aria-label") ?? button.textContent,
            width: bounds.width,
            height: bounds.height,
          };
        })
        .filter(({ width, height }) => width < 44 || height < 44),
    );
  expect(undersized).toEqual([]);
}

async function transitionDurationSeconds(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration;
    if (value.endsWith("ms")) return Number.parseFloat(value) / 1_000;
    return Number.parseFloat(value);
  });
}

async function focusWithKeyboard(
  page: Page,
  target: Locator,
  maximumTabs = 10,
): Promise<void> {
  for (let index = 0; index < maximumTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
  }
  throw new Error("Keyboard focus did not reach the expected control.");
}

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/auth/mock-onboarding/reset");
  expect(response.status()).toBe(204);
});

test("guarded fault journeys fail closed and recover without external credentials", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({
    [MOCK_OFFICE_FAULT_HEADER]: "installation",
  });
  await page.goto("/office");
  await expect(
    page.getByRole("heading", { name: "The office is unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel(/Message #/)).toHaveCount(0);
  await expect(page.getByText("Development mode")).toHaveCount(0);

  await page.setExtraHTTPHeaders({
    [MOCK_OFFICE_FAULT_HEADER]: "authentication",
  });
  await page.goto("/office");
  await expect(
    page.getByRole("heading", { name: "Sign-in is temporarily unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel(/Message #/)).toHaveCount(0);

  await page.setExtraHTTPHeaders({});
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(page.getByText("Welcome, Terry Byte")).toBeVisible();

  await page.setExtraHTTPHeaders({
    [MOCK_OFFICE_FAULT_HEADER]: "maintenance",
  });
  await page.goto("/office");
  await expect(
    page.getByRole("heading", {
      name: "Portal Messenger is under maintenance",
    }),
  ).toBeVisible();
  await expect(page.getByLabel(/Message #/)).toHaveCount(0);

  await page.setExtraHTTPHeaders({});
  await page.reload();
  await expect(page.getByText("Welcome, Terry Byte")).toBeVisible();
});

test("desktop and mobile journeys preserve WCAG semantics, reduced motion, and touch targets", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expectNoWcagViolations(page);
  const observerEntry = page.getByRole("link", {
    name: "Enter the Shared Public Office",
  });
  expect(await transitionDurationSeconds(observerEntry)).toBeLessThanOrEqual(
    0.000_01,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expectNoWcagViolations(page);
  await expectVisibleButtonTouchTargets(page);

  const mobileEntry = page
    .getByRole("link", { name: "Enter the Shared Public Office" })
    .filter({ visible: true });
  await focusWithKeyboard(page, mobileEntry);
  await expect(mobileEntry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/sign-in\?redirect_url=%2Foffice$/);
  await expectVisibleButtonTouchTargets(page);
  const returningEntry = page.getByRole("button", {
    name: "Sign in as Returning New Hire",
  });
  await focusWithKeyboard(page, returningEntry);
  await expect(returningEntry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Shared Public Office", { exact: true }),
  ).toBeVisible();
  await expectNoWcagViolations(page);
  await expectVisibleButtonTouchTargets(page);

  await page
    .getByRole("navigation", { name: "Office Channel directory" })
    .getByRole("button", { name: /# general/ })
    .click();
  const composer = page.getByLabel("Message # General");
  await composer.fill("Accessible mobile memo");
  await expectVisibleButtonTouchTargets(page);
  expect(
    await transitionDurationSeconds(page.getByRole("button", { name: "Send" })),
  ).toBeLessThanOrEqual(0.000_01);
  await expectNoWcagViolations(page);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByText("Welcome, Terry Byte")).toBeVisible();
  await expectNoWcagViolations(page);
});
