import { describe, expect, test } from "bun:test";
import type {
  HRReportInvalidationEvent,
  HRReportNotificationPublisher,
} from "@/lib/hr-reports/contract";
import {
  dismissHRReport,
  listHRReportsForReview,
  submitMessageHRReport,
  submitProfileHRReport,
} from "@/lib/hr-reports/service";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const createdAt = new Date("2026-07-22T12:00:00.000Z");
const dismissedAt = new Date("2026-07-22T12:05:00.000Z");
const publisher: HRReportNotificationPublisher = {
  async publishHRReportNotification() {},
};

describe("Operator HR Report review", () => {
  test("lists message and profile reports with their current context and state", async () => {
    const repository = createInMemoryNeonRepository(() => createdAt);
    const shared = {
      repository,
      publisher,
      reporterId: "user_reporter",
      operatorIds: ["user_operator"],
      appOrigin: "https://office.example.com",
      now: createdAt,
    };

    await submitMessageHRReport({
      ...shared,
      category: "threatening-behavior",
      officeDay: "2026-07-22",
      officeChannelId: "urgent:2026-07-22",
      messageId: "message-19",
    });
    await submitProfileHRReport({
      ...shared,
      category: "impersonation",
      profileId: "user_profile_subject",
    });

    const reports = await listHRReportsForReview({
      repository,
      appOrigin: shared.appOrigin,
    });

    expect(reports).toHaveLength(2);
    expect(reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectType: "message",
          category: "threatening-behavior",
          state: "open",
          href: "https://office.example.com/office?officeDay=2026-07-22&channel=urgent&message=message-19",
        }),
        expect.objectContaining({
          subjectType: "profile",
          category: "impersonation",
          state: "open",
          href: "https://office.example.com/office?profile=user_profile_subject",
        }),
      ]),
    );
  });

  test("dismisses once under concurrent retries and records one private audit", async () => {
    const repository = createInMemoryNeonRepository(() => createdAt);
    const invalidations: HRReportInvalidationEvent[] = [];
    const invalidationPublisher = {
      async publishHRReportInvalidation(event: HRReportInvalidationEvent) {
        invalidations.push(event);
      },
    };
    const submission = await submitMessageHRReport({
      repository,
      publisher,
      reporterId: "user_reporter",
      category: "harassment-or-bullying",
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-concurrent",
      operatorIds: ["user_operator"],
      appOrigin: "https://office.example.com",
      now: createdAt,
    });

    const attempts = await Promise.all([
      dismissHRReport({
        repository,
        reportId: submission.reportId,
        operatorId: "user_operator",
        privateNote: "Reviewed in context; harmless office banter.",
        publisher: invalidationPublisher,
        now: dismissedAt,
      }),
      dismissHRReport({
        repository,
        reportId: submission.reportId,
        operatorId: "user_operator",
        privateNote: "Reviewed in context; harmless office banter.",
        publisher: invalidationPublisher,
        now: dismissedAt,
      }),
    ]);

    expect(attempts.map(({ status }) => status).sort()).toEqual([
      "already-dismissed",
      "dismissed",
    ]);
    expect(repository.operatorActionRecords()).toEqual([
      expect.objectContaining({
        operatorId: "user_operator",
        targetType: "hr_report",
        targetId: submission.reportId,
        action: "dismissed",
        privateNote: "Reviewed in context; harmless office banter.",
        actedAt: dismissedAt,
      }),
    ]);
    expect(invalidations).toEqual([
      expect.objectContaining({
        type: "report.invalidated",
        reportId: submission.reportId,
      }),
    ]);
    expect(JSON.stringify(invalidations)).not.toMatch(
      /harmless office banter|harassment-or-bullying|user_reporter/i,
    );

    const [reviewed] = await listHRReportsForReview({
      repository,
      appOrigin: "https://office.example.com",
    });
    expect(reviewed).toMatchObject({
      state: "dismissed",
      resolution: {
        operatorId: "user_operator",
        action: "dismissed",
        privateNote: "Reviewed in context; harmless office banter.",
        actedAt: dismissedAt.toISOString(),
      },
    });
  });
});
