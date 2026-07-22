import { describe, expect, test } from "bun:test";
import type {
  HRReportNotification,
  HRReportNotificationPublisher,
} from "@/lib/hr-reports/contract";
import {
  flushHRReportNotifications,
  submitMessageHRReport,
  submitProfileHRReport,
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
      "profileId",
      "removedAt",
      "removedBy",
      "reportId",
      "reporterId",
      "state",
      "subjectNewHireId",
      "subjectType",
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
      title: "Message HR Report ready for review",
      subjectType: "message",
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

describe("New Hire Profile HR Report workflow", () => {
  test("keeps profile idempotency separate from message idempotency without retaining profile values", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const published: HRReportNotification[] = [];
    const publisher: HRReportNotificationPublisher = {
      async publishHRReportNotification(notification) {
        published.push(notification);
      },
    };
    const shared = {
      repository,
      publisher,
      reporterId: "user_reporter",
      operatorIds: ["user_operator"],
      appOrigin: "https://office.example.com",
      now,
    };

    expect(
      await submitProfileHRReport({
        ...shared,
        category: "abusive-or-hateful-name",
        profileId: "user_profile_subject",
      }),
    ).toMatchObject({ status: "created", notificationStatus: "sent" });
    expect(
      await submitProfileHRReport({
        ...shared,
        category: "abusive-or-hateful-name",
        profileId: "user_profile_subject",
      }),
    ).toMatchObject({
      status: "already-reported",
      notificationStatus: "sent",
    });
    expect(
      await submitMessageHRReport({
        ...shared,
        category: "harassment-or-bullying",
        officeDay: "2026-07-22",
        officeChannelId: "general:2026-07-22",
        messageId: "user_profile_subject",
      }),
    ).toMatchObject({ status: "created", notificationStatus: "sent" });

    expect(repository.hrReportRecords()).toHaveLength(2);
    expect(published).toHaveLength(2);
    expect(repository.hrReportRecords()[0]).toEqual(
      expect.objectContaining({
        subjectType: "profile",
        profileId: "user_profile_subject",
        officeDay: null,
        officeChannelId: null,
        messageId: null,
      }),
    );
    expect(Object.keys(repository.hrReportRecords()[0] ?? {}).sort()).toEqual([
      "category",
      "createdAt",
      "messageId",
      "officeChannelId",
      "officeDay",
      "profileId",
      "removedAt",
      "removedBy",
      "reportId",
      "reporterId",
      "state",
      "subjectNewHireId",
      "subjectType",
      "updatedAt",
    ]);
    expect(JSON.stringify(repository.hrReportRecords())).not.toMatch(
      /displayName|imageUrl|firstName|lastName|pictureUrl/i,
    );
  });

  test("retries a delayed profile notification using only its stable identity", async () => {
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
      await submitProfileHRReport({
        repository,
        publisher,
        reporterId: "user_reporter",
        category: "abusive-or-explicit-picture",
        profileId: "user_profile_subject",
        operatorIds: ["user_operator"],
        appOrigin: "https://office.example.com",
        now,
      }),
    ).toMatchObject({ status: "created", notificationStatus: "pending" });

    // Mutable Clerk profile values can change before notification delivery;
    // the committed workflow and delayed link remain stable-value only.
    await repository.projectProfile({
      clerkUserId: "user_profile_subject",
      firstName: "Renamed",
      lastName: "Hire",
      displayName: "Renamed Hire",
      imageUrl: "https://images.example/new.png",
      sourceVersion: 2,
    });
    fail = false;
    expect(
      await flushHRReportNotifications({
        repository,
        publisher,
        operatorIds: ["user_operator"],
        appOrigin: "https://office.example.com",
      }),
    ).toBe(1);
    expect(attempts[1]).toEqual(
      expect.objectContaining({
        subjectType: "profile",
        title: "New Hire Profile HR Report ready for review",
        profileId: "user_profile_subject",
        href: "https://office.example.com/office?profile=user_profile_subject",
      }),
    );
    expect(JSON.stringify(attempts)).not.toMatch(
      /abusive-or-explicit-picture|Renamed Hire|new\.png|user_reporter/,
    );
  });

  test("keeps stable review lookup when the subject profile is no longer available", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const published: HRReportNotification[] = [];
    const publisher: HRReportNotificationPublisher = {
      async publishHRReportNotification(notification) {
        published.push(notification);
      },
    };

    expect(
      await submitProfileHRReport({
        repository,
        publisher,
        reporterId: "user_reporter",
        category: "impersonation",
        profileId: "user_deleted_profile_subject",
        operatorIds: [],
        appOrigin: "https://office.example.com",
        now,
      }),
    ).toMatchObject({ status: "created", notificationStatus: "pending" });
    expect(
      await repository.getProfiles(["user_deleted_profile_subject"]),
    ).toEqual([
      expect.objectContaining({
        clerkUserId: "user_deleted_profile_subject",
        imageUrl: null,
        status: "unavailable",
      }),
    ]);

    expect(
      await flushHRReportNotifications({
        repository,
        publisher,
        operatorIds: ["user_operator"],
        appOrigin: "https://office.example.com",
      }),
    ).toBe(1);
    expect(repository.hrReportRecords()).toHaveLength(1);
    expect(published[0]).toMatchObject({
      subjectType: "profile",
      profileId: "user_deleted_profile_subject",
      href: "https://office.example.com/office?profile=user_deleted_profile_subject",
    });
  });
});
