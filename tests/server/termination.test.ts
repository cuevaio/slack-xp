import { describe, expect, test } from "bun:test";
import { handleTerminationRequest } from "@/app/api/office/operator/termination/route";
import {
  reinstateNewHire,
  sendHomeNewHire,
  terminateNewHire,
} from "@/lib/employment/service";
import type { HRReportNotificationPublisher } from "@/lib/hr-reports/contract";
import { submitProfileHRReport } from "@/lib/hr-reports/service";
import { officeEventChannelId } from "@/lib/office-events/contract";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import { listOfficeChannels } from "@/lib/portal/channels";
import { createPortalControlPlane } from "@/lib/portal/server";
import { issueOfficePortalSession } from "@/lib/portal/session";
import { createMockPortalAdapter } from "../support/portal";

const now = new Date("2026-07-22T21:15:00.000Z");
const profile = {
  clerkUserId: "user_termination_target",
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
  await repository.enterNewHire(profile);
  await repository.confirmProfile(profile.clerkUserId);
  await repository.acceptConduct(profile.clerkUserId);
  return repository.clockIn(profile.clerkUserId);
}

describe("Termination service", () => {
  test("persists across Office Days, disconnects active access, and remains idempotent", async () => {
    let current = now;
    const repository = createInMemoryNeonRepository(() => current);
    const portal = createMockPortalAdapter({ now: () => current });
    const onboarding = await completedTarget(repository);
    const report = await submitProfileHRReport({
      repository,
      publisher: notificationPublisher,
      reporterId: "user_reporter",
      category: "impersonation",
      profileId: profile.clerkUserId,
      operatorIds: ["user_operator"],
      appOrigin: "https://office.example.com",
      now,
    });
    const channelIds = [
      ...listOfficeChannels(now).map(({ id }) => id),
      officeEventChannelId(now),
    ];
    for (const channelId of channelIds) {
      await portal.ensureMembership({
        channelId,
        userId: profile.clerkUserId,
        claims: { username: profile.displayName, avatar: null },
      });
    }
    const connection = portal.connect({
      clientId: "terminated-client",
      channelId: channelIds[0] ?? "",
      userId: profile.clerkUserId,
      mode: "standard",
    });
    const input = {
      repository,
      portal,
      requestId: "termination-request-22",
      operatorId: "user_operator",
      targetNewHireId: profile.clerkUserId,
      privateReason: "Private serious-conduct review.",
      reportId: report.reportId,
      now,
    };

    expect((await terminateNewHire(input)).status).toBe("terminated");
    expect((await terminateNewHire(input)).status).toBe("already-terminated");
    expect(connection.status()).toBe("blocked");
    expect(portal.activeBans(profile.clerkUserId)).toEqual(
      channelIds.map((channelId) => ({ channelId, expiresAt: null })),
    );
    expect(repository.terminationRecords()).toHaveLength(1);
    expect(repository.hrReportRecords()[0]?.state).toBe("actioned");
    expect(
      repository
        .operatorActionRecords()
        .filter(({ action }) => action === "terminated"),
    ).toHaveLength(1);
    expect(JSON.stringify(portal.publicTerminationEvents())).not.toMatch(
      /serious-conduct|private/i,
    );

    current = new Date("2026-07-25T09:00:00.000Z");
    const access = await repository.getEmploymentAccess(
      profile.clerkUserId,
      current,
    );
    expect(access).toMatchObject({ eligible: false, reason: "terminated" });
    await expect(
      issueOfficePortalSession({
        identity: {
          id: profile.clerkUserId,
          fullName: profile.displayName,
          imageUrl: null,
        },
        onboarding,
        portal,
        now: current,
        employmentAccess: access,
      }),
    ).rejects.toThrow("Complete New Employee Setup");
    expect(portal.membershipCount("general:2026-07-25")).toBe(0);
  });

  test("links reversal to its original action and preserves an active Send Home", async () => {
    let current = now;
    const repository = createInMemoryNeonRepository(() => current);
    const portal = createMockPortalAdapter({ now: () => current });
    await completedTarget(repository);
    await sendHomeNewHire({
      repository,
      portal,
      requestId: "send-home-overlap-22",
      operatorId: "user_operator",
      targetNewHireId: profile.clerkUserId,
      privateReason: "Private same-day safety reason.",
      now,
    });
    const termination = await terminateNewHire({
      repository,
      portal,
      requestId: "termination-overlap-22",
      operatorId: "user_operator",
      targetNewHireId: profile.clerkUserId,
      privateReason: "Private persistent reason.",
      now,
    });
    current = new Date("2026-07-22T22:00:00.000Z");
    const reinstatement = await reinstateNewHire({
      repository,
      portal,
      requestId: "reinstatement-overlap-22",
      operatorId: "user_second_operator",
      targetNewHireId: profile.clerkUserId,
      privateReason: "Private reversal reason.",
      now: current,
    });

    expect(reinstatement.terminationId).toBe(termination.terminationId);
    expect(repository.reinstatementRecords()).toContainEqual(
      expect.objectContaining({
        terminationId: termination.terminationId,
        operatorId: "user_second_operator",
      }),
    );
    expect(
      await repository.getEmploymentAccess(profile.clerkUserId, current),
    ).toMatchObject({
      eligible: false,
      reason: "sent-home",
      until: new Date("2026-07-23T00:00:00.000Z"),
    });
    expect(portal.activeBans(profile.clerkUserId)).toHaveLength(6);
    expect(
      portal
        .activeBans(profile.clerkUserId)
        .every(({ expiresAt }) => expiresAt === "2026-07-23T00:00:00.000Z"),
    ).toBe(true);
    expect(repository.operatorActionRecords()).toContainEqual(
      expect.objectContaining({
        action: "reinstated",
        privateNote: "Private reversal reason.",
      }),
    );

    current = new Date("2026-07-23T00:00:00.000Z");
    expect(
      await repository.getEmploymentAccess(profile.clerkUserId, current),
    ).toEqual({ eligible: true, reason: null, until: null });
  });

  test("collapses concurrent Terminations into one active record and audit", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    await completedTarget(repository);
    const shared = {
      repository,
      portal,
      operatorId: "user_operator",
      targetNewHireId: profile.clerkUserId,
      privateReason: "Private safety reason.",
      now,
    };
    const results = await Promise.all([
      terminateNewHire({ ...shared, requestId: "concurrent-termination-a" }),
      terminateNewHire({ ...shared, requestId: "concurrent-termination-b" }),
    ]);
    expect(
      new Set(results.map(({ terminationId }) => terminationId)).size,
    ).toBe(1);
    expect(repository.terminationRecords()).toHaveLength(1);
    expect(
      repository
        .operatorActionRecords()
        .filter(({ action }) => action === "terminated"),
    ).toHaveLength(1);
  });
});

describe("Termination server and Portal boundaries", () => {
  test("rechecks Operator authorization and requires a private reason", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    await completedTarget(repository);
    const request = (privateReason: string) =>
      new Request(
        "https://office.example.com/api/office/operator/termination",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: "termination-boundary-22",
            targetNewHireId: profile.clerkUserId,
            privateReason,
          }),
        },
      );
    expect(
      (
        await handleTerminationRequest(request("Private reason"), {
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
        await handleTerminationRequest(request("   "), {
          repository,
          portal,
          requesterId: "user_operator",
          operatorUserIds: "user_operator",
          now,
        })
      ).status,
    ).toBe(422);
    expect(repository.terminationRecords()).toEqual([]);
  });

  test("uses persistent ban and published unban control-plane requests", async () => {
    const requests: Array<{ method: string; url: string; body: unknown }> = [];
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({
          method: init?.method ?? "GET",
          url: String(input),
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        return Response.json({ applied: true });
      },
      { preconnect: fetch.preconnect },
    );
    const portal = createPortalControlPlane({
      secret: "sk_termination_test",
      fetcher,
    });
    await portal.applyTerminationBans({
      channelIds: ["general:2026-07-22"],
      newHireId: profile.clerkUserId,
    });
    await portal.reconcileReinstatementBans({
      channelIds: ["general:2026-07-22"],
      newHireId: profile.clerkUserId,
      sentHomeUntil: null,
    });
    expect(requests).toEqual([
      {
        method: "POST",
        url: "https://api.useportal.co/v1/channels/general%3A2026-07-22/bans",
        body: { userId: profile.clerkUserId },
      },
      {
        method: "DELETE",
        url: `https://api.useportal.co/v1/channels/general%3A2026-07-22/bans/${profile.clerkUserId}`,
        body: null,
      },
    ]);
  });
});
