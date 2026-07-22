import { describe, expect, test } from "bun:test";
import { handleOperatorHRReportRequest } from "@/app/api/office/operator/hr-reports/route";
import type { HRReportNotificationPublisher } from "@/lib/hr-reports/contract";
import { submitMessageHRReport } from "@/lib/hr-reports/service";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const now = new Date("2026-07-22T13:00:00.000Z");
const publisher: HRReportNotificationPublisher = {
  async publishHRReportNotification() {},
};

async function fixture() {
  const repository = createInMemoryNeonRepository(() => now);
  const report = await submitMessageHRReport({
    repository,
    publisher,
    reporterId: "user_reporter",
    category: "sexual-content",
    officeDay: "2026-07-22",
    officeChannelId: "general:2026-07-22",
    messageId: "message-boundary",
    operatorIds: ["user_operator"],
    appOrigin: "https://office.example.com",
    now,
  });
  return { repository, report };
}

function request(method: "GET" | "PATCH", body?: unknown) {
  return new Request(
    "https://office.example.com/api/office/operator/hr-reports",
    {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

describe("Operator HR Report server boundary", () => {
  test("rejects direct non-Operator reads and mutations before changing state", async () => {
    const { repository, report } = await fixture();
    const dependencies = {
      repository,
      clerkUserId: "user_attacker",
      configuredUserIds: "user_operator",
      appOrigin: "https://office.example.com",
      now,
    };

    expect(
      (await handleOperatorHRReportRequest(request("GET"), dependencies))
        .status,
    ).toBe(403);
    expect(
      (
        await handleOperatorHRReportRequest(
          request("PATCH", {
            reportId: report.reportId,
            privateNote: "Forged dismissal",
          }),
          dependencies,
        )
      ).status,
    ).toBe(403);
    expect(repository.hrReportRecords()[0]?.state).toBe("open");
    expect(repository.operatorActionRecords()).toEqual([]);
  });

  test("rechecks allowlist changes on every query and mutation", async () => {
    const { repository, report } = await fixture();
    const base = {
      repository,
      clerkUserId: "user_operator",
      appOrigin: "https://office.example.com",
      now,
    };

    const allowed = await handleOperatorHRReportRequest(request("GET"), {
      ...base,
      configuredUserIds: "user_operator",
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      reports: [expect.objectContaining({ reportId: report.reportId })],
    });

    const revoked = await handleOperatorHRReportRequest(
      request("PATCH", { reportId: report.reportId, privateNote: null }),
      { ...base, configuredUserIds: "user_replacement" },
    );
    expect(revoked.status).toBe(403);
    expect(repository.hrReportRecords()[0]?.state).toBe("open");
  });

  test("validates and privately records an Operator dismissal", async () => {
    const { repository, report } = await fixture();
    const dependencies = {
      repository,
      clerkUserId: "user_operator",
      configuredUserIds: "user_operator",
      appOrigin: "https://office.example.com",
      now,
    };

    const invalid = await handleOperatorHRReportRequest(
      request("PATCH", {
        reportId: report.reportId,
        privateNote: "x".repeat(1_001),
      }),
      dependencies,
    );
    expect(invalid.status).toBe(422);

    const dismissed = await handleOperatorHRReportRequest(
      request("PATCH", {
        reportId: report.reportId,
        privateNote: "No policy issue found after review.",
      }),
      dependencies,
    );
    expect(dismissed.status).toBe(200);
    expect(await dismissed.json()).toEqual({
      reportId: report.reportId,
      status: "dismissed",
    });
    expect(repository.operatorActionRecords()[0]?.privateNote).toBe(
      "No policy issue found after review.",
    );
  });
});
