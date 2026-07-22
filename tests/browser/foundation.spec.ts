import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request }) => {
  const response = await request.post("/api/auth/mock-onboarding/reset");
  expect(response.status()).toBe(204);
});

test("Observer teaser supports accessible first entry and returning entry", async ({
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

  expect(
    requests.filter((url) => /useportal|\/api\/office\/portal/i.test(url)),
  ).toHaveLength(0);

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
  expect(
    requests.filter((url) => /useportal\.co|clerk\.com/i.test(url)),
  ).toHaveLength(0);
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

test("server boundaries reject invalid setup and forged identity", async ({
  page,
}) => {
  const forgedResponse = await page.request.get("/api/office/session", {
    headers: { "x-clerk-user-id": "user_mock_operator" },
  });
  expect(forgedResponse.status()).toBe(401);

  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as New Hire" }).click();

  const earlyPortalToken = await page.request.post("/api/office/portal/token");
  expect(earlyPortalToken.status()).toBe(403);

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
  expect((await page.request.post("/api/office/portal/token")).status()).toBe(
    401,
  );
});

test("general chat confirms, reconnects, validates text, and recovers from Portal faults", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();

  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();
  const composer = page.getByLabel("Message # General");
  await composer.fill(
    "Read <b>carefully</b> at https://example.com/handbook. javascript:alert(1)",
  );
  await page.getByRole("button", { name: "Send" }).click();

  const message = page.getByRole("listitem").filter({
    hasText: "Read <b>carefully</b>",
  });
  await expect(message).toBeVisible();
  await expect(message).not.toContainText("Sending…");
  const safeLink = message.getByRole("link", {
    name: "https://example.com/handbook",
  });
  await expect(safeLink).toHaveAttribute("target", "_blank");
  await expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");

  const firstToken = await page.request.post("/api/office/portal/token");
  const secondToken = await page.request.post("/api/office/portal/token");
  expect(firstToken.status()).toBe(200);
  expect(secondToken.status()).toBe(200);
  expect((await firstToken.json()).token).not.toBe(
    (await secondToken.json()).token,
  );

  expect(
    (
      await page.request.post("/api/office/portal/mock-chat", {
        data: { text: "A".repeat(1_001) },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.post("/api/office/portal/mock-chat", {
        data: { html: "<b>not text</b>" },
      })
    ).status(),
  ).toBe(422);

  await page.reload();
  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Read <b>carefully</b>" }),
  ).toBeVisible();

  await page.request.post("/api/auth/mock-portal", {
    form: { intent: "fail-next-send" },
  });
  await composer.fill("Please retry this memo");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Message not delivered")).toBeVisible();
  await expect(composer).toHaveValue("Please retry this memo");
  const retryConfirmation = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/office/portal/mock-chat" &&
      response.request().method() === "POST" &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Retry send" }).click();
  await retryConfirmation;
  await expect(page.getByText("Message not delivered")).toHaveCount(0);

  await page.request.post("/api/auth/mock-portal", {
    form: { intent: "offline" },
  });
  await page.reload();
  await expect(
    page.getByText("Portal is offline.").filter({ visible: true }),
  ).toBeVisible();
  await expect(composer).toBeDisabled();
  await page.request.post("/api/auth/mock-portal", {
    form: { intent: "online" },
  });
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText("Please retry this memo")).toBeVisible();
});

test("a New Hire edits an Employee Record with accessible recovery and current attribution", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  const composer = page.getByLabel("Message # General");
  await composer.fill("This memo should follow my current profile.");
  await page.getByRole("button", { name: "Send" }).click();
  const historicalMessage = page.getByRole("listitem").filter({
    hasText: "This memo should follow my current profile.",
  });
  await expect(historicalMessage.getByRole("strong")).toHaveText("Terry Byte");

  const trigger = page.getByRole("button", { name: "Employee Record" });
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Confirm your Employee Record",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("First name")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();

  await trigger.click();
  await dialog.getByLabel("First name").fill("A".repeat(40));
  await dialog.getByLabel("Last name").fill("B".repeat(50));
  await dialog.getByRole("button", { name: "Save Employee Record" }).click();
  await expect(dialog.locator("#employee-first-name-error")).toContainText(
    "80 characters or fewer",
  );
  await expect(dialog.getByLabel("First name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(dialog.getByLabel("First name")).toBeFocused();
  await expect(dialog.getByLabel("Last name")).toHaveValue("B".repeat(50));

  await page.request.post("/api/auth/mock-profile", {
    form: { intent: "reject-next-update" },
  });
  await dialog.getByLabel("First name").fill("Taylor");
  await dialog.getByLabel("Last name").fill("Byte");
  const retry = dialog.getByRole("button", { name: "Retry Employee Record" });
  await retry.click();
  const errorAlert = dialog.getByRole("alert");
  await expect(errorAlert).toContainText("Clerk did not accept");
  await expect(dialog.getByLabel("First name")).toHaveValue("Taylor");
  await expect(errorAlert).toBeFocused();

  await dialog.getByLabel(/Profile picture/).setInputFiles({
    name: "taylor.png",
    mimeType: "image/png",
    buffer: Buffer.from("deterministic mock image"),
  });
  await page.request.post("/api/auth/mock-profile", {
    form: { intent: "partially-update-next" },
  });
  await retry.click();
  await expect(dialog.getByRole("alert")).toContainText("Clerk saved the name");
  await expect(dialog.getByLabel("First name")).toHaveValue("Taylor");

  await page.request.post("/api/auth/mock-profile", {
    form: { intent: "delay-next-projection" },
  });
  await dialog.getByRole("button", { name: "Retry Employee Record" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Clerk saved the changes",
  );
  await expect(dialog.getByRole("status")).toContainText(
    "updated in Clerk and the Shared Public Office",
  );
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(trigger).toBeFocused();

  await expect(
    page.getByRole("heading", { name: "Welcome, Taylor Byte" }),
  ).toBeVisible();
  await expect(historicalMessage.getByRole("strong")).toHaveText("Taylor Byte");
});

test("the complete Office Channel directory switches without losing per-channel state", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();

  const directory = page.getByRole("navigation", {
    name: "Office Channel directory",
  });
  await expect(directory.getByRole("button")).toHaveCount(5);
  await expect(directory.getByRole("button")).toHaveText([
    /# general\s+General/,
    /# watercooler\s+Watercooler/,
    /# tech-support\s+Technical Support/,
    /# urgent\s+Urgent/,
    /# all-hands\s+All Hands/,
  ]);

  const portalSession = await page.request.post("/api/office/portal/token");
  expect(portalSession.status()).toBe(200);
  expect((await portalSession.json()).channelIds).toEqual([
    expect.stringMatching(/^general:\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^watercooler:\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^tech-support:\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^urgent:\d{4}-\d{2}-\d{2}$/),
    expect.stringMatching(/^all-hands:\d{4}-\d{2}-\d{2}$/),
  ]);

  const generalComposer = page.getByLabel("Message # General");
  await generalComposer.fill("General draft stays put");
  await directory.getByRole("button", { name: /# watercooler/ }).click();
  const watercoolerComposer = page.getByLabel("Message # Watercooler");
  await watercoolerComposer.fill("Watercooler draft stays put");
  await directory.getByRole("button", { name: /# general/ }).click();
  await expect(generalComposer).toHaveValue("General draft stays put");
  await directory.getByRole("button", { name: /# watercooler/ }).click();
  await expect(watercoolerComposer).toHaveValue("Watercooler draft stays put");

  await page.request.post("/api/auth/mock-portal", {
    form: { intent: "fail-next-send" },
  });
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Message not delivered")).toBeVisible();
  await directory.getByRole("button", { name: /# general/ }).click();
  await directory.getByRole("button", { name: /# watercooler/ }).click();
  await expect(watercoolerComposer).toHaveValue("Watercooler draft stays put");
  await expect(page.getByText("Message not delivered")).toBeVisible();

  await directory.getByRole("button", { name: /# all-hands/ }).click();
  await expect(
    page.getByText("System Events receive priority display."),
  ).toBeVisible();
  await expect(
    page.getByText(/Broadcast mode changes presentation and presence only/),
  ).toBeVisible();
  await expect(page.getByLabel("Message # All Hands")).toBeEnabled();
});

test("an open office ends at midnight and reconnects only after a delayed continuation", async ({
  page,
}) => {
  const firstOfficeDay = "2026-07-22";
  const delayedOfficeDay = "2026-07-25";
  const recoveredOfficeDay = "2026-07-26";
  const mockChatRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/office/portal/mock-chat") {
      mockChatRequests.push(request.url());
    }
  });
  await page.setExtraHTTPHeaders({
    "x-portal-mock-now": `${firstOfficeDay}T12:00:00.000Z`,
  });
  await page.clock.install({
    time: new Date(`${firstOfficeDay}T12:00:00.000Z`),
  });
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();

  const oldComposer = page.getByLabel("Message # General");
  await oldComposer.fill("This stale draft must be cleared");
  await page.clock.pauseAt(new Date(`${firstOfficeDay}T23:59:59.999Z`));
  await page.clock.fastForward(1);

  const shiftEndedDialog = page.getByRole("dialog", {
    name: "Your shift has ended",
  });
  await expect(shiftEndedDialog).toBeVisible();
  const continueButton = shiftEndedDialog.getByRole("button", {
    name: "Continue to the new Office Day",
  });
  await expect(continueButton).toBeFocused();
  await expect(page.getByRole("textbox", { name: /Message #/ })).toHaveCount(0);

  const disconnectedRequestCount = mockChatRequests.length;
  await page.clock.fastForward("01:00");
  expect(mockChatRequests).toHaveLength(disconnectedRequestCount);

  await page.clock.setSystemTime(new Date(`${delayedOfficeDay}T09:15:00.000Z`));
  await page.setExtraHTTPHeaders({
    "x-portal-mock-now": `${delayedOfficeDay}T09:15:00.000Z`,
  });
  const nextSessionResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/office/portal/token" &&
      response.status() === 200,
  );
  await continueButton.click();
  const nextSession = await (await nextSessionResponse).json();
  expect(nextSession.channelIds).toEqual([
    `general:${delayedOfficeDay}`,
    `watercooler:${delayedOfficeDay}`,
    `tech-support:${delayedOfficeDay}`,
    `urgent:${delayedOfficeDay}`,
    `all-hands:${delayedOfficeDay}`,
  ]);
  expect(nextSession.eventChannelId).toBe(`office-events:${delayedOfficeDay}`);
  const freshComposer = page.getByLabel("Message # General");
  await expect(freshComposer).toBeVisible();
  await expect(freshComposer).toHaveAttribute(
    "id",
    `message-general:${delayedOfficeDay}`,
  );
  await expect(freshComposer).toHaveValue("");
  await expect(freshComposer).toBeFocused();

  await page.clock.setSystemTime(
    new Date(`${recoveredOfficeDay}T08:00:00.000Z`),
  );
  await page.setExtraHTTPHeaders({
    "x-portal-mock-now": `${recoveredOfficeDay}T08:00:00.000Z`,
  });
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(shiftEndedDialog).toBeVisible();
  await expect(continueButton).toBeFocused();
});

test("history paginates backward without duplicates and displays canonical time locally", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();

  let latestTimestamp = 0;
  for (let index = 1; index <= 51; index += 1) {
    const response = await page.request.post(
      "/api/office/portal/mock-chat?channel=general",
      { data: { text: `Pagination memo ${index}` } },
    );
    expect(response.status()).toBe(200);
    latestTimestamp = (await response.json()).timestamp;
  }

  await page.reload();
  await expect(
    page
      .getByText("Online — messages are persistent")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pagination memo 1", { exact: true }),
  ).toHaveCount(0);
  const historyRegion = page
    .locator(".chat-scroll-region")
    .filter({ visible: true });
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(
    page.getByText("Pagination memo 1", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveCount(51);
  await expect
    .poll(() => historyRegion.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);

  const expectedLocalTime = await page.evaluate(
    (timestamp) =>
      new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
      }).format(timestamp),
    latestTimestamp,
  );
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Pagination memo 51" })
      .locator("time"),
  ).toHaveText(expectedLocalTime);
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

  await expect(
    page.getByText("Shared Public Office", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.getByLabel("Message # General")).toBeVisible();
  await page
    .getByRole("navigation", { name: "Office Channel directory" })
    .getByRole("button", { name: /# all-hands/ })
    .click();
  await expect(page.getByLabel("Message # All Hands")).toBeVisible();
  await expect(
    page.getByText("System Events receive priority display."),
  ).toBeVisible();
});
