import { describe, expect, test } from "bun:test";
import type {
  HRReportNotification,
  HRReportNotificationPublisher,
} from "@/lib/hr-reports/contract";
import {
  flushHRReportNotifications,
  submitMessageHRReport,
} from "@/lib/hr-reports/service";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const now = new Date("2026-07-22T12:00:00.000Z");

describe("message HR Report workflow", () => {
  test("commits one body-free open report and outbox entry across duplicate retries", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const published: HRReportNotification[] = [];
    const publisher: HRReportNotificationPublisher = {
      async publishHRReportNotification(notification) {
        published.push(notification);
      },
    };
    const input = {
      repository,
      publisher,
      reporterId: "user_reporter",
      category: "harassment-or-bullying" as const,
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-17",
      operatorIds: ["user_operator"],
      appOrigin: "https://office.example.com",
      now,
    };

    expect(await submitMessageHRReport(input)).toMatchObject({
      status: "created",
      notificationStatus: "sent",
    });
    expect(await submitMessageHRReport(input)).toMatchObject({
      status: "already-reported",
      notificationStatus: "sent",
    });
    expect(repository.hrReportRecords()).toHaveLength(1);
    expect(repository.hrReportNotificationRecords()).toHaveLength(1);
    expect(published).toHaveLength(1);

    const serialized = JSON.stringify({
      reports: repository.hrReportRecords(),
      outbox: repository.hrReportNotificationRecords(),
    });
    expect(serialized).not.toMatch(
      /messageBody|preview|presence|conversation/i,
    );
    expect(Object.keys(repository.hrReportRecords()[0] ?? {}).sort()).toEqual([
      "category",
      "createdAt",
      "messageId",
      "officeChannelId",
      "officeDay",
      "reportId",
      "reporterId",
      "state",
      "updatedAt",
    ]);
  });

  test("keeps the committed report pending through notification failure and retries it", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    let fail = true;
    const attempts: HRReportNotification[] = [];
    const publisher: HRReportNotificationPublisher = {
      async publishHRReportNotification(notification) {
        attempts.push(notification);
        if (fail) throw new Error("controlled Portal outage");
      },
    };

    expect(
      await submitMessageHRReport({
        repository,
        publisher,
        reporterId: "user_reporter",
        category: "threatening-behavior",
        officeDay: "2026-07-22",
        officeChannelId: "urgent:2026-07-22",
        messageId: "message-urgent-17",
        operatorIds: ["user_operator"],
        appOrigin: "https://office.example.com",
        now,
      }),
    ).toMatchObject({ status: "created", notificationStatus: "pending" });
    expect(repository.hrReportRecords()).toHaveLength(1);
    expect(repository.hrReportNotificationRecords()[0]?.publishedAt).toBeNull();

    fail = false;
    expect(
      await flushHRReportNotifications({
        repository,
        publisher,
        operatorIds: ["user_operator"],
        appOrigin: "https://office.example.com",
      }),
    ).toBe(1);
    expect(
      await flushHRReportNotifications({
        repository,
        publisher,
        operatorIds: ["user_operator"],
        appOrigin: "https://office.example.com",
      }),
    ).toBe(0);
    expect(attempts.map(({ notificationId }) => notificationId)).toEqual([
      attempts[0]?.notificationId,
      attempts[0]?.notificationId,
    ]);
    expect(attempts[1]).toMatchObject({
      type: "hr-report.ready",
      title: "HR Report ready for review",
      officeDay: "2026-07-22",
      officeChannelId: "urgent:2026-07-22",
      messageId: "message-urgent-17",
      href: "https://office.example.com/office?officeDay=2026-07-22&channel=urgent&message=message-urgent-17",
    });
    expect(JSON.stringify(attempts)).not.toMatch(
      /threatening-behavior|user_reporter/,
    );
  });
});
