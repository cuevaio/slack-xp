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

  await expect(
    page.getByRole("heading", { name: "Welcome, Patricia Pending" }),
  ).toBeVisible();
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
  const earlyHRReport = await page.request.post("/api/office/hr-reports", {
    data: {
      category: "harassment-or-bullying",
      officeChannelId: "general:2026-07-22",
      messageId: "message-forged",
    },
  });
  expect(earlyHRReport.status()).toBe(403);

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

test("message HR Reports stay private and deep-link Operators to review context", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();

  const reportText = "Private HR Report browser target";
  await page.getByLabel("Message # General").fill(reportText);
  await page.getByRole("button", { name: "Send" }).click();
  const message = page.getByRole("listitem").filter({ hasText: reportText });
  await expect(message).toBeVisible();

  await message.getByRole("button", { name: "Report to HR" }).click();
  const dialog = page.getByRole("dialog", { name: "Private HR Report" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(4);
  await expect(
    dialog.getByRole("radio", { name: "Harassment or bullying" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    message.getByRole("button", { name: "Report to HR" }),
  ).toBeFocused();
  await message.getByRole("button", { name: "Report to HR" }).click();
  await dialog.getByRole("radio", { name: "Threatening behavior" }).check();

  const reportRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/office/hr-reports" &&
      request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Submit private report" }).click();
  const submittedRequest = await reportRequest;
  expect(submittedRequest.postDataJSON()).toEqual({
    category: "threatening-behavior",
    officeChannelId: expect.stringMatching(/^general:/),
    messageId: expect.stringMatching(/^mock_message_/),
  });
  expect(submittedRequest.postData()).not.toContain(reportText);
  await expect(message.getByText("Private HR Report submitted.")).toBeVisible();

  const duplicate = await page.request.post("/api/office/hr-reports", {
    data: submittedRequest.postDataJSON(),
  });
  expect(duplicate.status()).toBe(200);
  const duplicatePayload = await duplicate.json();
  expect(duplicatePayload).toMatchObject({ status: "already-reported" });

  expect(
    (await page.request.get("/api/office/operator/hr-reports")).status(),
  ).toBe(403);
  expect(
    (
      await page.request.patch("/api/office/operator/hr-reports", {
        data: {
          reportId: duplicatePayload.reportId,
          privateNote: "Forged Operator note",
        },
      })
    ).status(),
  ).toBe(403);
  await expect(
    page.getByRole("region", { name: "HR Report review queue" }),
  ).toHaveCount(0);

  const publicEvents = await page.request.get("/api/office/portal/mock-events");
  expect(JSON.stringify(await publicEvents.json())).not.toMatch(
    /hr-report|threatening-behavior/i,
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as Operator" }).click();
  const notification = page.getByRole("link", {
    name: "Message HR Report ready for review, open message context",
  });
  await expect(notification).toBeVisible();
  await notification.click();
  await expect(page).toHaveURL(
    /officeDay=.*&channel=general&message=mock_message_/,
  );
  const reviewMessage = page
    .getByRole("listitem")
    .filter({ hasText: reportText });
  await expect(reviewMessage).toBeVisible();
  await expect(reviewMessage).toBeFocused();

  const queue = page.getByRole("region", {
    name: "HR Report review queue",
  });
  const queueItem = queue
    .getByRole("listitem")
    .filter({ hasText: "Threatening behavior" });
  await expect(queueItem).toContainText("Message HR Report");
  await expect(queueItem).toContainText("open");
  await queueItem
    .getByLabel("Private Operator note (optional)")
    .fill("Reviewed in context; harmless office banter.");
  await queueItem.getByRole("button", { name: "Dismiss HR Report" }).click();
  await expect(queueItem).toContainText("dismissed");
  await expect(queueItem).toContainText(
    "Reviewed in context; harmless office banter.",
  );

  const dismissalEvents = await page.request.get(
    "/api/office/portal/mock-events",
  );
  const serializedDismissalEvents = JSON.stringify(
    await dismissalEvents.json(),
  );
  expect(serializedDismissalEvents).toContain("report.invalidated");
  expect(serializedDismissalEvents).not.toMatch(
    /harmless office banter|threatening-behavior|user_reporter/i,
  );
});

test("Operators remove messages inline while every connected client renders a persistent tombstone", async ({
  browser,
  page,
}) => {
  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as Operator" }).click();

  const removedText = "Remove this confidential Portal payload";
  await page.getByLabel("Message # General").fill(removedText);
  await page.getByRole("button", { name: "Send" }).click();
  const operatorMessage = page
    .getByRole("listitem")
    .filter({ hasText: removedText });
  await expect(operatorMessage).toBeVisible();
  const messageId = await operatorMessage.getAttribute("data-message-id");
  const originalTimestamp = await operatorMessage
    .locator("time")
    .getAttribute("datetime");

  const colleagueContext = await browser.newContext();
  const colleague = await colleagueContext.newPage();
  await colleague.goto("/office");
  await colleague
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  const colleagueMessage = colleague
    .getByRole("listitem")
    .filter({ hasText: removedText });
  await expect(colleagueMessage).toBeVisible();
  await expect(
    colleagueMessage.getByRole("button", { name: "Remove message" }),
  ).toHaveCount(0);

  const trigger = operatorMessage.getByRole("button", {
    name: "Remove message",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Remove this message?" });
  await expect(dialog.getByLabel("Private Operator reason")).toBeFocused();
  await expect(dialog).toContainText(
    "does not retract or erase the payload from Portal storage",
  );
  await expect(dialog).toContainText(
    "authorized direct Portal client may still retrieve it",
  );
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog
    .getByLabel("Private Operator reason")
    .fill("Private review confirmed a policy violation.");

  const removalRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname ===
        "/api/office/operator/message-removals" && request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Confirm removal" }).click();
  const submittedRequest = await removalRequest;
  expect(submittedRequest.postDataJSON()).toEqual({
    officeChannelId: expect.stringMatching(/^general:/),
    messageId,
    privateReason: "Private review confirmed a policy violation.",
  });
  expect(submittedRequest.postData()).not.toContain(removedText);

  const operatorTombstone = page
    .locator(`[data-message-id="${messageId}"]`)
    .filter({ hasText: "Removed Message" });
  await expect(operatorTombstone).toBeVisible();
  await expect(operatorTombstone).not.toContainText(removedText);
  await expect(operatorTombstone.locator("time")).toHaveAttribute(
    "datetime",
    originalTimestamp ?? "",
  );

  const colleagueTombstone = colleague
    .locator(`[data-message-id="${messageId}"]`)
    .filter({ hasText: "Removed Message" });
  await expect(colleagueTombstone).toBeVisible();
  await expect(colleagueTombstone).not.toContainText(removedText);

  const publicEvents = await page.request.get("/api/office/portal/mock-events");
  const serializedEvents = JSON.stringify(await publicEvents.json());
  expect(serializedEvents).toContain("message-removal.invalidated");
  expect(serializedEvents).not.toMatch(
    /Private review confirmed|Remove this confidential Portal payload/i,
  );

  const directPortalHistory = await page.request.get(
    "/api/office/portal/mock-chat?channel=general",
  );
  expect(JSON.stringify(await directPortalHistory.json())).toContain(
    removedText,
  );

  await page.route("**/api/office/message-removals?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "projection_unavailable" }),
    }),
  );
  await page.reload();
  await expect(
    page
      .getByText("Removed Message records are unavailable.")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByText(removedText, { exact: true })).toHaveCount(0);
  await page.unroute("**/api/office/message-removals?**");
  await page.reload();
  await expect(
    page
      .locator(`[data-message-id="${messageId}"]`)
      .filter({ hasText: "Removed Message" }),
  ).toBeVisible();
  await expect(page.getByText(removedText, { exact: true })).toHaveCount(0);
  await colleagueContext.close();
});

test("New Hire Profile HR Reports follow current canonical profile context", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();

  const reportText = "Open my current New Hire Profile.";
  await page.getByLabel("Message # General").fill(reportText);
  await page.getByRole("button", { name: "Send" }).click();
  const message = page.getByRole("listitem").filter({ hasText: reportText });
  await message
    .getByRole("link", {
      name: "Open current New Hire Profile for Terry Byte",
    })
    .click();
  await expect(page).toHaveURL(
    /\/office\?profile=user_mock_returning_new_hire$/,
  );

  const profile = page.getByRole("dialog", { name: "New Hire Profile" });
  await expect(
    profile.getByRole("heading", { name: "Terry Byte" }),
  ).toBeVisible();
  await profile.getByRole("button", { name: "Report to HR" }).click();
  const reportDialog = page.getByRole("dialog", { name: "Private HR Report" });
  await expect(reportDialog.getByRole("radio")).toHaveCount(3);
  await expect(
    reportDialog.getByRole("radio", { name: "Abusive or hateful name" }),
  ).toBeFocused();
  await reportDialog
    .getByRole("radio", { name: "Abusive or explicit picture" })
    .check();

  const reportRequest = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === "/api/office/hr-reports" &&
      request.method() === "POST",
  );
  await reportDialog
    .getByRole("button", { name: "Submit private report" })
    .click();
  const submittedRequest = await reportRequest;
  expect(submittedRequest.postDataJSON()).toEqual({
    subjectType: "profile",
    profileId: "user_mock_returning_new_hire",
    category: "abusive-or-explicit-picture",
  });
  expect(submittedRequest.postData()).not.toContain("Terry Byte");
  await expect(profile.getByText("Private HR Report submitted.")).toBeVisible();

  const duplicate = await page.request.post("/api/office/hr-reports", {
    data: submittedRequest.postDataJSON(),
  });
  expect(duplicate.status()).toBe(200);
  expect(await duplicate.json()).toMatchObject({ status: "already-reported" });

  await profile.getByRole("button", { name: "Close New Hire Profile" }).click();
  await page.getByRole("button", { name: "Employee Record" }).click();
  const employeeRecord = page.getByRole("dialog", {
    name: "Confirm your Employee Record",
  });
  await employeeRecord.getByLabel("First name").fill("Current");
  await employeeRecord.getByLabel("Last name").fill("Profile");
  await employeeRecord
    .getByRole("button", { name: "Save Employee Record" })
    .click();
  await expect(employeeRecord.getByRole("status")).toContainText(
    "updated in Clerk and the Shared Public Office",
  );
  await employeeRecord.getByRole("button", { name: "Done" }).click();

  const publicEvents = await page.request.get("/api/office/portal/mock-events");
  expect(JSON.stringify(await publicEvents.json())).not.toMatch(
    /hr-report|abusive-or-explicit-picture|Terry Byte/i,
  );

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/office");
  await page.getByRole("button", { name: "Sign in as Operator" }).click();
  const notification = page.getByRole("link", {
    name: "New Hire Profile HR Report ready for review, open current New Hire Profile",
  });
  await expect(notification).toBeVisible();
  await notification.click();
  await expect(page).toHaveURL(
    /\/office\?profile=user_mock_returning_new_hire$/,
  );
  const reviewProfile = page.getByRole("dialog", {
    name: "New Hire Profile",
  });
  await expect(
    reviewProfile.getByRole("heading", { name: "Current Profile" }),
  ).toBeVisible();
  await expect(reviewProfile.getByText("Terry Byte")).toHaveCount(0);
  const queueItem = page
    .getByRole("region", { name: "HR Report review queue" })
    .getByRole("listitem")
    .filter({ hasText: "Abusive or explicit picture" });
  await expect(queueItem).toContainText("Profile HR Report");
  await expect(queueItem).toContainText("open");
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
      .getByText("Connected — live updates available")
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
      .getByText("Connected — live updates available")
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
      .getByText("Connected — live updates available")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Please retry this memo", { exact: true }),
  ).toBeVisible();
});

test("live presence resolves New Hire Profiles and all-hands stays aggregate", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  const generalRoster = page.getByRole("list", {
    name: "General current New Hires",
  });
  await expect(generalRoster).toContainText("Terry Byte");
  await expect(
    generalRoster.locator('[data-new-hire-id="user_mock_returning_new_hire"]'),
  ).toBeVisible();
  await expect(generalRoster).not.toContainText("Office Character");

  const directory = page.getByRole("navigation", {
    name: "Office Channel directory",
  });
  await directory.getByRole("button", { name: /# all-hands/ }).click();
  await expect(page.getByText("All-hands attendance")).toBeVisible();
  await expect(
    page.getByText("1 New Hire is currently connected."),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "All Hands current New Hires" }),
  ).toHaveCount(0);
});

test("scripted System Events visibly identify fictional Office Characters", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();

  const systemEvent = page.locator(".system-event-message").filter({
    hasText: "motivational poster has been rebooted",
  });
  await expect(systemEvent).toBeVisible();
  await expect(systemEvent).toContainText("Barb Dwyer");
  await expect(systemEvent).toContainText("Office Character · Fictional");
  await expect(
    systemEvent.getByRole("button", { name: /reaction/i }),
  ).toHaveCount(0);

  const generalRoster = page.getByRole("list", {
    name: "General current New Hires",
  });
  await expect(generalRoster).not.toContainText("Barb Dwyer");
});

test("emoji reactions use the fixed accessible palette and survive reconnect", async ({
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(
    page
      .getByText("Connected — live updates available")
      .filter({ visible: true }),
  ).toBeVisible();

  await page.getByLabel("Message # General").fill("Please react to this memo");
  await page.getByRole("button", { name: "Send" }).click();
  const message = page.getByRole("listitem").filter({
    hasText: "Please react to this memo",
  });
  const trigger = message.getByRole("button", {
    name: "Add or remove a reaction",
  });
  await expect(trigger).toBeEnabled();
  const triggerBounds = await trigger.boundingBox();
  expect(triggerBounds?.width).toBeGreaterThanOrEqual(44);
  expect(triggerBounds?.height).toBeGreaterThanOrEqual(44);

  await trigger.click();
  const palette = message.getByRole("group", { name: "Choose a reaction" });
  await expect(palette.getByRole("button")).toHaveCount(6);
  await expect(
    palette.getByRole("button", { name: /Thumbs up \(👍\), add/ }),
  ).toBeFocused();
  expect(
    await palette
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-label")),
      ),
  ).toEqual([
    "Thumbs up (👍), add reaction",
    "Heart (❤️), add reaction",
    "Laughing (😂), add reaction",
    "Surprised (😮), add reaction",
    "Sad (😢), add reaction",
    "Celebrate (🎉), add reaction",
  ]);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  await palette.getByRole("button", { name: /Celebrate/ }).click();
  const ownReaction = message.getByRole("button", {
    name: /Celebrate: 1 reaction\. Remove your reaction/,
  });
  await expect(ownReaction).toBeVisible();
  await expect(ownReaction).toHaveAttribute("aria-pressed", "true");
  await expect(trigger).toBeFocused();

  await page.reload();
  await expect(
    page
      .getByText("Connected — live updates available")
      .filter({ visible: true }),
  ).toBeVisible();
  const replayedMessage = page.getByRole("listitem").filter({
    hasText: "Please react to this memo",
  });
  const replayedReaction = replayedMessage.getByRole("button", {
    name: /Celebrate: 1 reaction\. Remove your reaction/,
  });
  await expect(replayedReaction).toBeVisible();
  await replayedReaction.click();
  await expect(replayedReaction).toHaveCount(0);

  await page.reload();
  await expect(
    page
      .getByText("Connected — live updates available")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Please react to this memo" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Celebrate: 1 reaction/ }),
  ).toHaveCount(0);
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
      .getByText("Connected — live updates available")
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

test("Portal inbox attention reconciles across New Hires and visible desktop/mobile navigation", async ({
  browser,
  page,
}) => {
  await page.goto("/office");
  await page
    .getByRole("button", { name: "Sign in as Returning New Hire" })
    .click();
  await expect(page.getByText("Inbox current").first()).toBeVisible();

  const colleagueContext = await browser.newContext();
  const colleague = await colleagueContext.newPage();
  await colleague.goto("/office");
  await colleague.getByRole("button", { name: "Sign in as New Hire" }).click();
  await colleague.getByRole("button", { name: "Save Employee Record" }).click();
  await colleague.getByRole("checkbox").check();
  await colleague.getByRole("button", { name: "Accept and Continue" }).click();
  await colleague.getByRole("button", { name: "CLOCK IN" }).click();

  const readerDirectory = page.locator(
    'nav[aria-label="Office Channel directory"]',
  );
  const colleagueDirectory = colleague.getByRole("navigation", {
    name: "Office Channel directory",
  });
  await colleagueDirectory
    .getByRole("button", { name: /# watercooler/ })
    .click();
  await colleague
    .getByLabel("Message # Watercooler")
    .fill("The coffee machine has requested legal representation.");
  await colleague.getByRole("button", { name: "Send" }).click();

  const watercoolerRow = readerDirectory.getByRole("button", {
    name: /# watercooler/,
  });
  await expect(watercoolerRow).toContainText(
    "New Hire: The coffee machine has requested legal representation.",
  );
  await expect(watercoolerRow).toHaveAccessibleName(/2 unread/);
  await expect(
    page.getByRole("button", {
      name: "Focus Office Channel directory, 5 unread",
    }),
  ).toBeVisible();

  await watercoolerRow.click();
  await expect(
    page.getByText("The coffee machine has requested legal representation.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(watercoolerRow).not.toHaveAccessibleName(/1 unread/);

  await page.request.post("/api/auth/mock-portal", {
    form: { intent: "offline" },
  });
  await expect(page.getByText("Reconnecting inbox…").first()).toBeVisible();
  await page.request.post("/api/auth/mock-portal", {
    form: { intent: "online" },
  });

  await colleagueDirectory.getByRole("button", { name: /# urgent/ }).click();
  await colleague
    .getByLabel("Message # Urgent")
    .fill("The fax machine is now considered mission critical.");
  await colleague.getByRole("button", { name: "Send" }).click();

  const urgentRow = readerDirectory
    .locator("button")
    .filter({ hasText: "# urgent" });
  await expect(urgentRow).toContainText(
    "New Hire: The fax machine is now considered mission critical.",
  );
  await expect(urgentRow).toHaveAccessibleName(/2 unread/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(readerDirectory).toBeVisible();
  await expect(page.getByLabel("Message # Watercooler")).not.toBeVisible();
  await urgentRow.click();
  const directoryTrigger = page.getByRole("button", {
    name: "Open Office Channel directory",
  });
  await expect(directoryTrigger).toBeFocused();
  await expect(
    page.getByText("The fax machine is now considered mission critical.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(urgentRow).not.toHaveAccessibleName(/1 unread/);

  await directoryTrigger.click();
  await expect(readerDirectory).toBeVisible();
  await expect(urgentRow).toBeFocused();
  await colleagueContext.close();
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
      .getByText("Connected — live updates available")
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
  await page.getByRole("button", { name: "Sign in as Operator" }).click();
  await expect(
    page
      .getByText("Connected — live updates available")
      .filter({ visible: true }),
  ).toBeVisible();

  let latestTimestamp = 0;
  let earliestMessageId = "";
  let generalChannelId = "";
  for (let index = 1; index <= 51; index += 1) {
    const response = await page.request.post(
      "/api/office/portal/mock-chat?channel=general",
      { data: { text: `Pagination memo ${index}` } },
    );
    expect(response.status()).toBe(200);
    const message = await response.json();
    earliestMessageId ||= message.id;
    generalChannelId ||= message.channelId;
    latestTimestamp = message.timestamp;
  }
  const removal = await page.request.post(
    "/api/office/operator/message-removals",
    {
      data: {
        officeChannelId: generalChannelId,
        messageId: earliestMessageId,
        privateReason: "Pagination tombstone coverage.",
      },
    },
  );
  expect(removal.status()).toBe(201);

  await page.reload();
  await expect(
    page
      .getByText("Connected — live updates available")
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Pagination memo 1", { exact: true }),
  ).toHaveCount(0);
  const historyRegion = page
    .locator(".chat-scroll-region")
    .filter({ visible: true });
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  const paginatedTombstone = page.locator(
    `[data-message-id="${earliestMessageId}"]`,
  );
  await expect(paginatedTombstone).toContainText("Removed Message");
  await expect(paginatedTombstone).not.toContainText("Pagination memo 1");
  await expect(page.locator(".message-history > li")).toHaveCount(52);
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
  await expect(page.getByLabel("Message # General")).not.toBeVisible();
  await page
    .getByRole("navigation", { name: "Office Channel directory" })
    .getByRole("button", { name: /# all-hands/ })
    .click();
  await expect(page.getByLabel("Message # All Hands")).toBeVisible();
  await expect(
    page.getByText("System Events receive priority display."),
  ).toBeVisible();
});
