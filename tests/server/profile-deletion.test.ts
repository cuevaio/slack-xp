import { describe, expect, test } from "bun:test";
import { officeEventChannelId } from "@/lib/office-events/contract";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import { listOfficeChannels } from "@/lib/portal/channels";
import { createMockPortalAdapter } from "@/lib/portal/mock";
import {
  issueOfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";
import { deleteClerkProfile } from "@/lib/profiles/deletion";
import type { ProfileInvalidationEvent } from "@/lib/profiles/types";

const now = new Date("2026-07-23T12:00:00.000Z");
const profile = {
  clerkUserId: "user_deleted_account",
  firstName: "Privacy",
  lastName: "Please",
  displayName: "Privacy Please",
  imageUrl: "https://img.example/private.png",
  sourceVersion: now.getTime() - 1_000,
};

describe("Clerk account deletion", () => {
  test("disconnects active Portal access while preserving stable attribution", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const portal = createMockPortalAdapter({ now: () => now });
    const onboarding = await repository.enterNewHire(profile);
    await repository.confirmProfile(profile.clerkUserId);
    await repository.acceptConduct(profile.clerkUserId);
    const completed = await repository.clockIn(profile.clerkUserId);
    const channelIds = [
      ...listOfficeChannels(now).map(({ id }) => id),
      officeEventChannelId(now),
    ];
    for (const channelId of channelIds) {
      await portal.ensureMembership({
        channelId,
        userId: profile.clerkUserId,
        claims: { username: profile.displayName, avatar: profile.imageUrl },
      });
    }
    const connection = portal.connect({
      clientId: "deleted-account-client",
      channelId: channelIds[0] ?? "",
      userId: profile.clerkUserId,
      mode: "standard",
    });
    const preservedMessage = await portal.sendMessage({
      channelId: channelIds[0] ?? "",
      senderId: profile.clerkUserId,
      content: { text: "Preserved Portal history" },
    });

    await deleteClerkProfile({
      repository,
      portal,
      tombstone: {
        clerkUserId: profile.clerkUserId,
        sourceVersion: now.getTime(),
        deletedAt: now,
      },
      now,
    });
    const invalidationsAfterFirstDelivery = portal
      .officeEvents(officeEventChannelId(now))
      .filter(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "content" in event &&
          typeof event.content === "object" &&
          event.content !== null &&
          "type" in event.content &&
          event.content.type === "profile.invalidated",
      ).length;
    await deleteClerkProfile({
      repository,
      portal,
      tombstone: {
        clerkUserId: profile.clerkUserId,
        sourceVersion: now.getTime(),
        deletedAt: now,
      },
      now,
    });

    expect(connection.status()).toBe("blocked");
    connection.reconnect();
    expect(connection.status()).toBe("blocked");
    expect(portal.activeBans(profile.clerkUserId)).toEqual(
      channelIds.map((channelId) => ({ channelId, expiresAt: null })),
    );
    expect(await repository.getProfiles([profile.clerkUserId])).toEqual([
      {
        clerkUserId: profile.clerkUserId,
        displayName: "Former Employee",
        imageUrl: null,
        status: "former",
      },
    ]);
    const access = await repository.getEmploymentAccess(
      profile.clerkUserId,
      now,
    );
    expect(access).toEqual({ eligible: false, reason: "deleted", until: null });
    await expect(
      issueOfficePortalSession({
        identity: {
          id: profile.clerkUserId,
          fullName: profile.displayName,
          imageUrl: profile.imageUrl,
        },
        onboarding: completed,
        portal,
        now,
        employmentAccess: access,
      }),
    ).rejects.toBeInstanceOf(PortalEligibilityError);
    expect(repository.getNewHire(profile.clerkUserId)).resolves.toBeNull();
    expect(repository.operatorActionRecords()).toEqual([]);
    expect(portal.publicTerminationEvents()).toEqual([]);
    expect(await portal.history(channelIds[0] ?? "")).toEqual([
      preservedMessage,
    ]);
    await expect(
      repository.recordReinstatement({
        reinstatementId: "forged-reinstatement",
        requestId: "forged-reinstatement-request",
        operatorId: "user_operator",
        targetNewHireId: profile.clerkUserId,
        privateReason: "A deleted account has no Operator reversal.",
        reinstatedAt: now,
      }),
    ).rejects.toMatchObject({ code: "new_hire_deleted" });
    const profileInvalidations = (
      portal.officeEvents(officeEventChannelId(now)) as Array<{
        content: ProfileInvalidationEvent;
      }>
    ).filter(({ content }) => content.type === "profile.invalidated");
    expect(profileInvalidations).toHaveLength(invalidationsAfterFirstDelivery);
    expect(Object.keys(profileInvalidations[0]?.content ?? {}).sort()).toEqual([
      "eventKey",
      "occurredAt",
      "profileId",
      "type",
      "version",
    ]);
    expect(JSON.stringify(profileInvalidations)).not.toMatch(
      /Privacy Please|img\.example/iu,
    );
    expect(onboarding.clerkUserId).toBe(profile.clerkUserId);
  });
});
