import { describe, expect, test } from "bun:test";
import type { HRReportNotificationPublisher } from "@/lib/hr-reports/contract";
import {
  listHRReportsForReview,
  submitMessageHRReport,
} from "@/lib/hr-reports/service";
import type { MessageRemovalInvalidationEvent } from "@/lib/message-removals/contract";
import {
  flushMessageRemovalInvalidations,
  listMessageRemovals,
  removeMessage,
} from "@/lib/message-removals/service";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const removedAt = new Date("2026-07-22T12:05:00.000Z");
const notificationPublisher: HRReportNotificationPublisher = {
  async publishHRReportNotification() {},
};

describe("Removed Message projection", () => {
  test("commits one projection, report resolution, private audit, and retryable invalidation under concurrency", async () => {
    const repository = createInMemoryNeonRepository(() => removedAt);
    await submitMessageHRReport({
      repository,
      publisher: notificationPublisher,
      reporterId: "user_reporter",
      category: "threatening-behavior",
      officeDay: "2026-07-22",
      officeChannelId: "urgent:2026-07-22",
      messageId: "message-concurrent-removal",
      operatorIds: [],
      appOrigin: "https://office.example.com",
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    const invalidations: MessageRemovalInvalidationEvent[] = [];
    const publisher = {
      async publishMessageRemovalInvalidation(
        event: MessageRemovalInvalidationEvent,
      ) {
        invalidations.push(event);
      },
    };
    const input = {
      repository,
      publisher,
      operatorId: "user_operator",
      officeDay: "2026-07-22",
      officeChannelId: "urgent:2026-07-22",
      messageId: "message-concurrent-removal",
      privateReason: "Direct threat reviewed by the on-call Operator.",
      now: removedAt,
    };

    const attempts = await Promise.all([
      removeMessage(input),
      removeMessage(input),
    ]);

    expect(attempts.map(({ status }) => status).sort()).toEqual([
      "already-removed",
      "removed",
    ]);
    expect(repository.messageRemovalRecords()).toEqual([
      expect.objectContaining({
        officeDay: "2026-07-22",
        officeChannelId: "urgent:2026-07-22",
        messageId: "message-concurrent-removal",
        removedBy: "user_operator",
        removedAt,
      }),
    ]);
    expect(repository.operatorActionRecords()).toEqual([
      expect.objectContaining({
        operatorId: "user_operator",
        targetType: "message_removal",
        action: "removed",
        privateNote: "Direct threat reviewed by the on-call Operator.",
        actedAt: removedAt,
      }),
    ]);
    expect(repository.hrReportRecords()[0]).toMatchObject({
      state: "removed",
      removedBy: "user_operator",
      removedAt,
    });
    const [reviewed] = await listHRReportsForReview({
      repository,
      appOrigin: "https://office.example.com",
    });
    expect(reviewed).toMatchObject({ state: "removed", resolution: null });
    expect(await repository.pendingHRReportNotifications(10)).toEqual([]);
    expect(
      repository.messageRemovalInvalidationRecords()[0]?.publishedAt,
    ).toBeInstanceOf(Date);
    expect(new Set(invalidations.map(({ eventKey }) => eventKey)).size).toBe(1);
    expect(JSON.stringify(invalidations)).not.toMatch(
      /Direct threat|privateReason|messageBody|content/i,
    );
  });

  test("returns body-free canonical projections for normal rendering", async () => {
    const repository = createInMemoryNeonRepository(() => removedAt);
    await removeMessage({
      repository,
      publisher: { async publishMessageRemovalInvalidation() {} },
      operatorId: "user_operator",
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-private-payload",
      privateReason: "Private reason that must not leave the audit.",
      now: removedAt,
    });

    const removals = await listMessageRemovals({
      repository,
      officeChannelId: "general:2026-07-22",
    });
    expect(removals).toEqual([
      expect.objectContaining({
        messageId: "message-private-payload",
        removedAt: removedAt.toISOString(),
      }),
    ]);
    expect(JSON.stringify(removals)).not.toMatch(
      /Private reason|operator|removedBy|body|content/i,
    );
  });

  test("leaves a failed invalidation pending and retries the same body-free event", async () => {
    const repository = createInMemoryNeonRepository(() => removedAt);
    const first = await removeMessage({
      repository,
      publisher: {
        async publishMessageRemovalInvalidation() {
          throw new Error("controlled Portal outage");
        },
      },
      operatorId: "user_operator",
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-retry-invalidation",
      privateReason: "Private retry reason.",
      now: removedAt,
    });
    expect(first.invalidationStatus).toBe("pending");
    expect(
      repository.messageRemovalInvalidationRecords()[0]?.publishedAt,
    ).toBeNull();

    const delivered: MessageRemovalInvalidationEvent[] = [];
    expect(
      await flushMessageRemovalInvalidations({
        repository,
        publisher: {
          async publishMessageRemovalInvalidation(event) {
            delivered.push(event);
          },
        },
      }),
    ).toBe(1);
    expect(delivered).toEqual([
      expect.objectContaining({
        type: "message-removal.invalidated",
        messageId: "message-retry-invalidation",
      }),
    ]);
    expect(JSON.stringify(delivered)).not.toMatch(/Private retry reason/i);
    expect(
      repository.messageRemovalInvalidationRecords()[0]?.publishedAt,
    ).toBeInstanceOf(Date);
  });
});
