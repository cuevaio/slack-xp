import { describe, expect, test } from "bun:test";
import { handleSendHomeRequest } from "@/app/api/office/operator/send-home/route";
import type { PublicSendHomeSystemEvent } from "@/lib/employment/contract";
import { sendHomeNewHire } from "@/lib/employment/service";
import type { HRReportNotificationPublisher } from "@/lib/hr-reports/contract";
import { submitProfileHRReport } from "@/lib/hr-reports/service";
import { officeEventChannelId } from "@/lib/office-events/contract";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import { listOfficeChannels } from "@/lib/portal/channels";
import { createPortalControlPlane } from "@/lib/portal/server";
import { createMockPortalAdapter } from "../support/portal";

const now = new Date("2026-07-22T21:15:00.000Z");
const targetProfile = {
  clerkUserId: "user_send_home_target",
  firstName: "Terry",
  lastName: "Byte",
  displayName: "Terry Byte",
  imageUrl: null,
  sourceVersion: 1,
};
const notificationPublisher: HRReportNotificationPublisher = {
  async publishHRReportNotification() {},
};

async function completedTarget(
  repository: ReturnType<typeof createInMemoryNeonRepository>,
) {
  await repository.enterNewHire(targetProfile);
  await repository.confirmProfile(targetProfile.clerkUserId);
  await repository.acceptConduct(targetProfile.clerkUserId);
  await repository.clockIn(targetProfile.clerkUserId);
}

describe("Send Home service", () => {
  test("records one private action, transitions its report, bans every daily channel, and disconnects", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    await completedTarget(repository);
    const report = await submitProfileHRReport({
      repository,
      publisher: notificationPublisher,
      reporterId: "user_reporter",
      category: "impersonation",
      profileId: targetProfile.clerkUserId,
      operatorIds: ["user_operator"],
      appOrigin: "https://office.example.com",
      now,
    });
    const dailyChannelIds = [
      ...listOfficeChannels(now).map(({ id }) => id),
      officeEventChannelId(now),
    ];
    for (const channelId of dailyChannelIds) {
      await portal.ensureMembership({
        channelId,
        userId: targetProfile.clerkUserId,
        claims: { username: targetProfile.displayName, avatar: null },
      });
    }
    const connection = portal.connect({
      clientId: "send-home-active-client",
      channelId: dailyChannelIds[0] ?? "",
      userId: targetProfile.clerkUserId,
      mode: "standard",
    });

    const result = await sendHomeNewHire({
      repository,
      portal,
      requestId: "send-home-request-21",
      operatorId: "user_operator",
      targetNewHireId: targetProfile.clerkUserId,
      privateReason: "Threat reviewed in the private HR Report.",
      reportId: report.reportId,
      now,
    });

    expect(result).toMatchObject({
      status: "sent-home",
      officeDay: "2026-07-22",
      expiresAt: new Date("2026-07-23T00:00:00.000Z"),
    });
    expect(connection.status()).toBe("blocked");
    expect(portal.activeBans(targetProfile.clerkUserId)).toEqual(
      dailyChannelIds.map((channelId) => ({
        channelId,
        expiresAt: "2026-07-23T00:00:00.000Z",
      })),
    );
    expect(repository.employmentActionRecords()).toHaveLength(1);
    expect(repository.operatorActionRecords()).toContainEqual(
      expect.objectContaining({
        action: "sent_home",
        operatorId: "user_operator",
        targetId: targetProfile.clerkUserId,
        privateNote: "Threat reviewed in the private HR Report.",
      }),
    );
    expect(repository.hrReportRecords()[0]?.state).toBe("actioned");

    const publicEvents = portal.publicSendHomeEvents();
    const invalidations = portal.officeEvents(officeEventChannelId(now));
    expect(publicEvents).toHaveLength(1);
    expect(invalidations).toHaveLength(1);
    expect(JSON.stringify({ publicEvents, invalidations })).not.toMatch(
      /Threat reviewed|impersonation|reporter|report-/i,
    );
  });

  test("is idempotent on retry and restores eligibility after midnight", async () => {
    let current = now;
    const repository = createInMemoryNeonRepository(() => current);
    const portal = createMockPortalAdapter({ now: () => current });
    await completedTarget(repository);
    const input = {
      repository,
      portal,
      requestId: "send-home-retry-21",
      operatorId: "user_operator",
      targetNewHireId: targetProfile.clerkUserId,
      privateReason: "Private safety reason.",
      now,
    };

    expect((await sendHomeNewHire(input)).status).toBe("sent-home");
    expect((await sendHomeNewHire(input)).status).toBe("already-sent-home");
    expect(repository.employmentActionRecords()).toHaveLength(1);
    expect(portal.publicSendHomeEvents()).toHaveLength(1);

    expect(
      await repository.getEmploymentAccess(targetProfile.clerkUserId, now),
    ).toMatchObject({ eligible: false, reason: "sent-home" });
    current = new Date("2026-07-23T00:00:00.000Z");
    expect(
      await repository.getEmploymentAccess(targetProfile.clerkUserId, current),
    ).toEqual({ eligible: true, reason: null, until: null });
    await expect(
      portal.ensureMembership({
        channelId: "general:2026-07-23",
        userId: targetProfile.clerkUserId,
        claims: { username: targetProfile.displayName, avatar: null },
      }),
    ).resolves.toBeUndefined();
  });

  test("applies bans even when another effect fails and resumes the outbox on retry", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    await completedTarget(repository);
    let failPublicEvent = true;
    const flakyPortal = {
      ...portal,
      async publishSendHomeSystemEvent(
        event: PublicSendHomeSystemEvent,
      ): Promise<void> {
        if (failPublicEvent) {
          failPublicEvent = false;
          throw new Error("controlled public event failure");
        }
        await portal.publishSendHomeSystemEvent(event);
      },
    };
    const input = {
      repository,
      requestId: "send-home-partial-effect-21",
      operatorId: "user_operator",
      targetNewHireId: targetProfile.clerkUserId,
      privateReason: "Private safety reason.",
      now,
    };

    await expect(
      sendHomeNewHire({ ...input, portal: flakyPortal }),
    ).rejects.toThrow("controlled public event failure");
    expect(portal.activeBans(targetProfile.clerkUserId)).toHaveLength(6);
    expect(repository.employmentActionRecords()).toHaveLength(1);
    expect(portal.publicSendHomeEvents()).toHaveLength(0);

    expect((await sendHomeNewHire({ ...input, portal })).status).toBe(
      "already-sent-home",
    );
    expect(repository.employmentActionRecords()).toHaveLength(1);
    expect(portal.publicSendHomeEvents()).toHaveLength(1);
  });
});

describe("Send Home server boundary", () => {
  test("rechecks Operator access and requires a private reason", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    await completedTarget(repository);
    const request = (privateReason: string) =>
      new Request("https://office.example.com/api/office/operator/send-home", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: "boundary-request-21",
          targetNewHireId: targetProfile.clerkUserId,
          privateReason,
        }),
      });

    expect(
      (
        await handleSendHomeRequest(request("Private reason"), {
          repository,
          portal,
          requesterId: "user_attacker",
          operatorUserIds: "user_operator",
          now,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await handleSendHomeRequest(request("   "), {
          repository,
          portal,
          requesterId: "user_operator",
          operatorUserIds: "user_operator",
          now,
        })
      ).status,
    ).toBe(422);
    expect(repository.employmentActionRecords()).toEqual([]);
  });
});

describe("Portal Send Home boundary", () => {
  test("sends one expiring ban per visible and hidden daily channel", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ applied: true });
      },
      { preconnect: fetch.preconnect },
    );
    const portal = createPortalControlPlane({
      secret: "sk_send_home_test",
      fetcher,
    });
    const channelIds = [
      ...listOfficeChannels(now).map(({ id }) => id),
      officeEventChannelId(now),
    ];
    await portal.applySendHomeBans({
      channelIds,
      newHireId: targetProfile.clerkUserId,
      expiresAt: new Date("2026-07-23T00:00:00.000Z"),
    });

    expect(requests.map(({ url }) => url)).toEqual(
      channelIds.map(
        (channelId) =>
          `https://api.useportal.co/v1/channels/${encodeURIComponent(channelId)}/bans`,
      ),
    );
    expect(requests.map(({ body }) => body)).toEqual(
      channelIds.map(() => ({
        userId: targetProfile.clerkUserId,
        expiresAt: "2026-07-23T00:00:00.000Z",
      })),
    );
  });
});
