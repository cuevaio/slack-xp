import { describe, expect, test } from "bun:test";
import {
  createReactionOfficeEvent,
  createReactionProjection,
  officeEventChannelId,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";
import { createMockPortalAdapter } from "@/lib/portal/mock";
import {
  createPortalControlPlane,
  createPortalProfileInvalidationPublisher,
} from "@/lib/portal/server";
import {
  issueOfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";

const completedNewHire = {
  clerkUserId: "user_portal_test",
  firstName: "Pat",
  lastName: "Pending",
  displayName: "Pat Pending",
  imageUrl: null,
  jobTitle: "Senior Mousepad Alignment Specialist",
  profileConfirmedAt: "2026-07-22T00:00:00.000Z",
  conductAcceptedAt: "2026-07-22T00:01:00.000Z",
  completedAt: "2026-07-22T00:02:00.000Z",
  step: "complete" as const,
};

describe("Portal control-plane boundary", () => {
  test("publishes profile invalidations as the reserved sender without profile values", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/members")) return Response.json({ added: 1 });
        if (url.endsWith("/tokens")) {
          return Response.json({
            token: "profile-publisher-token",
            expiresAt: "2026-07-22T12:15:00.000Z",
          });
        }
        return Response.json({
          id: "profile-event-message",
          timestamp: 1_753_184_800_000,
        });
      },
      { preconnect: fetch.preconnect },
    );
    const publisher = createPortalProfileInvalidationPublisher({
      secret: "sk_portal_test",
      apiKey: "pk_portal_test",
      fetcher,
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const event = {
      version: 1 as const,
      type: "profile.invalidated" as const,
      eventKey:
        "office-event:v1:profile.invalidated:profile_20_abcdef1234567890",
      occurredAt: "2026-07-22T11:59:00.000Z",
      profileId: "user_profile_test",
    };

    await publisher.publishProfileInvalidation(event);

    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.useportal.co/v1/channels/office-events%3A2026-07-22/members",
      "https://api.useportal.co/v1/tokens",
      "https://api.useportal.co/v1/channels/office-events%3A2026-07-22/messages",
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      userId: "office-events:profiles",
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toMatchObject({
      userId: "office-events:profiles",
      channels: { "office-events:2026-07-22": ["connect", "publish"] },
    });
    expect(JSON.parse(String(requests[2]?.init?.body))).toEqual({
      type: "office.event",
      content: event,
    });
    expect(String(requests[2]?.init?.body)).not.toMatch(/Pat|image|firstName/i);
  });

  test("adds every daily membership before minting a 15-minute office-scoped token", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(input), init });
        if (String(input).endsWith("/members")) {
          return Response.json({ added: 1 });
        }
        return Response.json({
          token: "portal-user-token",
          expiresAt: "2026-07-22T12:15:00.000Z",
        });
      },
      { preconnect: fetch.preconnect },
    );
    const portal = createPortalControlPlane({
      secret: "sk_portal_test",
      fetcher,
      apiUrl: "https://api.useportal.co",
    });

    const session = await issueOfficePortalSession({
      identity: {
        id: completedNewHire.clerkUserId,
        fullName: completedNewHire.displayName,
        imageUrl: null,
      },
      onboarding: completedNewHire,
      portal,
      now: new Date("2026-07-22T12:00:00.000Z"),
    });

    expect(session).toEqual({
      channelIds: [
        "general:2026-07-22",
        "watercooler:2026-07-22",
        "tech-support:2026-07-22",
        "urgent:2026-07-22",
        "all-hands:2026-07-22",
      ],
      eventChannelId: "office-events:2026-07-22",
      token: "portal-user-token",
      expiresAt: "2026-07-22T12:15:00.000Z",
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.useportal.co/v1/channels/general%3A2026-07-22/members",
      "https://api.useportal.co/v1/channels/watercooler%3A2026-07-22/members",
      "https://api.useportal.co/v1/channels/tech-support%3A2026-07-22/members",
      "https://api.useportal.co/v1/channels/urgent%3A2026-07-22/members",
      "https://api.useportal.co/v1/channels/all-hands%3A2026-07-22/members",
      "https://api.useportal.co/v1/channels/office-events%3A2026-07-22/members",
      "https://api.useportal.co/v1/tokens",
    ]);
    expect(requests[0]?.init?.headers).toEqual({
      Authorization: "Bearer sk_portal_test",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(requests.at(-1)?.init?.body))).toEqual({
      userId: "user_portal_test",
      claims: { username: "Pat Pending", avatar: null },
      channels: {
        "general:2026-07-22": ["connect", "publish"],
        "watercooler:2026-07-22": ["connect", "publish"],
        "tech-support:2026-07-22": ["connect", "publish"],
        "urgent:2026-07-22": ["connect", "publish"],
        "all-hands:2026-07-22": ["connect", "publish"],
        "office-events:2026-07-22": ["connect", "publish"],
      },
      ttl: "15m",
    });
  });

  test("denies token minting until onboarding is complete", async () => {
    const portal = createMockPortalAdapter();

    await expect(
      issueOfficePortalSession({
        identity: {
          id: completedNewHire.clerkUserId,
          fullName: completedNewHire.displayName,
          imageUrl: null,
        },
        onboarding: {
          ...completedNewHire,
          completedAt: null,
          step: "clock-in",
        },
        portal,
        now: new Date("2026-07-22T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(PortalEligibilityError);
    expect(portal.membershipCount("general:2026-07-22")).toBe(0);
    expect(
      portal.membershipCount(
        officeEventChannelId(new Date("2026-07-22T12:00:00.000Z")),
      ),
    ).toBe(0);
  });

  test("reports upstream failures without copying secrets or response details", async () => {
    const secret = "sk_never_log_this_value";
    const portal = createPortalControlPlane({
      secret,
      fetcher: Object.assign(
        async () =>
          Response.json(
            { code: "unauthorized", reason: `Rejected ${secret}` },
            { status: 401 },
          ),
        { preconnect: fetch.preconnect },
      ),
    });

    let failure: unknown;
    try {
      await portal.ensureMembership({
        channelId: "general:2026-07-22",
        userId: "user_portal_test",
        claims: { username: "Pat Pending", avatar: null },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "unauthorized", status: 401 });
    expect(JSON.stringify(failure)).not.toContain(secret);
    expect(failure instanceof Error ? failure.message : "").not.toContain(
      "Rejected",
    );
  });
});

describe("controlled Portal adapter", () => {
  test("reconciles authoritative per-New-Hire inbox state across reconnects", async () => {
    const portal = createMockPortalAdapter({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const channelId = "urgent:2026-07-22";
    for (const [userId, username] of [
      ["user_reader", "Reader"],
      ["user_writer", "Writer"],
    ] as const) {
      await portal.ensureMembership({
        channelId,
        userId,
        claims: { username, avatar: null },
      });
    }

    await portal.sendMessage({
      channelId,
      senderId: "user_writer",
      content: { text: "The printer has entered negotiations." },
    });

    expect(portal.inbox("user_reader", [channelId])).toEqual([
      expect.objectContaining({
        channelId,
        unread: 1,
        latest: {
          text: "The printer has entered negotiations.",
          senderId: "user_writer",
          at: 1_784_721_600_000,
        },
      }),
    ]);
    expect(portal.inbox("user_writer", [channelId])[0]?.unread).toBe(0);

    portal.setOnline(false);
    expect(() => portal.inbox("user_reader", [channelId])).toThrow(
      "temporarily unavailable",
    );
    portal.setOnline(true);
    expect(portal.inbox("user_reader", [channelId])[0]?.unread).toBe(1);

    portal.markInboxRead("user_reader", channelId);
    expect(portal.inbox("user_reader", [channelId])[0]?.unread).toBe(0);
  });

  test("keeps visible and event memberships idempotent", async () => {
    const portal = createMockPortalAdapter({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    const session = await issueOfficePortalSession({
      identity: {
        id: completedNewHire.clerkUserId,
        fullName: completedNewHire.displayName,
        imageUrl: null,
      },
      onboarding: completedNewHire,
      portal,
      now: new Date("2026-07-22T12:00:00.000Z"),
    });
    await issueOfficePortalSession({
      identity: {
        id: completedNewHire.clerkUserId,
        fullName: completedNewHire.displayName,
        imageUrl: null,
      },
      onboarding: completedNewHire,
      portal,
      now: new Date("2026-07-22T12:00:00.000Z"),
    });

    expect(session.channelIds).toHaveLength(5);
    for (const channelId of session.channelIds) {
      expect(portal.membershipCount(channelId)).toBe(1);
    }
    expect(session.eventChannelId).toBe("office-events:2026-07-22");
    expect(portal.membershipCount(session.eventChannelId)).toBe(1);
  });

  test("keeps membership and confirmed history idempotent across retry and reconnect", async () => {
    const portal = createMockPortalAdapter({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });

    await portal.ensureMembership({
      channelId: "general:2026-07-22",
      userId: "user_portal_test",
      claims: { username: "Pat Pending", avatar: null },
    });
    await portal.ensureMembership({
      channelId: "general:2026-07-22",
      userId: "user_portal_test",
      claims: { username: "Pat Pending", avatar: null },
    });
    expect(portal.membershipCount("general:2026-07-22")).toBe(1);

    const confirmed = await portal.sendMessage({
      channelId: "general:2026-07-22",
      senderId: "user_portal_test",
      content: { text: "Persistent hello" },
    });
    expect(confirmed.status).toBe("sent");
    expect(await portal.history("general:2026-07-22")).toEqual([confirmed]);

    portal.failNextSend();
    await expect(
      portal.sendMessage({
        channelId: "general:2026-07-22",
        senderId: "user_portal_test",
        content: { text: "Retry me" },
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(await portal.history("general:2026-07-22")).toEqual([confirmed]);

    const retried = await portal.sendMessage({
      channelId: "general:2026-07-22",
      senderId: "user_portal_test",
      content: { text: "Retry me" },
    });
    expect(await portal.history("general:2026-07-22")).toEqual([
      confirmed,
      retried,
    ]);
  });

  test("recovers after a controlled outage without inventing live data", async () => {
    const portal = createMockPortalAdapter();
    portal.setOnline(false);
    await expect(portal.history("general:2026-07-22")).rejects.toThrow(
      "temporarily unavailable",
    );

    portal.setOnline(true);
    expect(await portal.history("general:2026-07-22")).toEqual([]);
  });

  test("paginates backward without duplicates or client-created gaps", async () => {
    let tick = 0;
    const portal = createMockPortalAdapter({
      now: () => new Date(1_753_184_800_000 + tick++),
    });
    const channelId = "general:2026-07-22";
    await portal.ensureMembership({
      channelId,
      userId: "user_portal_test",
      claims: { username: "Pat Pending", avatar: null },
    });

    for (let index = 1; index <= 55; index += 1) {
      await portal.sendMessage({
        channelId,
        senderId: "user_portal_test",
        content: { text: `Memo ${index}` },
      });
    }

    const recent = await portal.historyPage(channelId, { limit: 20 });
    expect(recent.messages).toHaveLength(20);
    expect(recent.messages[0]?.content.text).toBe("Memo 36");
    expect(recent.hasPrevious).toBe(true);

    const previous = await portal.historyPage(channelId, {
      before: recent.messages[0]?.id,
      limit: 20,
    });
    const oldest = await portal.historyPage(channelId, {
      before: previous.messages[0]?.id,
      limit: 20,
    });
    const combined = [
      ...oldest.messages,
      ...previous.messages,
      ...recent.messages,
    ];
    expect(oldest.hasPrevious).toBe(false);
    expect(combined).toHaveLength(55);
    expect(new Set(combined.map(({ id }) => id)).size).toBe(55);
    expect(combined.map(({ content }) => content.text)).toEqual(
      Array.from({ length: 55 }, (_, index) => `Memo ${index + 1}`),
    );
  });

  test("persists authoritative reactions for connected clients and replay without visible unread activity", async () => {
    let tick = 0;
    const portal = createMockPortalAdapter({
      now: () => new Date(1_753_184_800_000 + tick++),
    });
    const officeChannelId = "general:2026-07-22";
    const eventChannelId = "office-events:2026-07-22";
    for (const userId of ["user_reactor", "user_observer"]) {
      for (const channelId of [officeChannelId, eventChannelId]) {
        await portal.ensureMembership({
          channelId,
          userId,
          claims: { username: userId, avatar: null },
        });
      }
    }
    const target = await portal.sendMessage({
      channelId: officeChannelId,
      senderId: "user_reactor",
      content: { text: "React to this persistent memo" },
    });
    const event = createReactionOfficeEvent({
      mutationId: "reaction-mutation-1",
      occurredAt: "2026-07-22T12:00:01.000Z",
      officeDay: "2026-07-22",
      officeChannelId,
      messageId: target.id,
      actorId: "user_reactor",
      reaction: "🎉",
      operation: "add",
    });
    const firstClient = createReactionProjection();
    const secondClient = createReactionProjection();
    const deliveries: ReactionOfficeEvent[] = [];
    portal.subscribeOfficeEvents(eventChannelId, "user_reactor", (message) => {
      deliveries.push(message.content);
      firstClient.apply(message.content);
    });
    const disconnectSecondClient = portal.subscribeOfficeEvents(
      eventChannelId,
      "user_observer",
      (message) => secondClient.apply(message.content),
    );

    await portal.sendOfficeEvent({
      channelId: eventChannelId,
      senderId: "user_reactor",
      content: event,
    });
    expect(firstClient.read(officeChannelId, target.id)).toEqual([
      { reaction: "🎉", actorIds: ["user_reactor"] },
    ]);
    expect(secondClient.read(officeChannelId, target.id)).toEqual([
      { reaction: "🎉", actorIds: ["user_reactor"] },
    ]);
    expect(deliveries).toEqual([event]);
    expect(portal.unreadCount(officeChannelId, "user_observer")).toBe(1);
    expect(portal.unreadCount(eventChannelId, "user_observer")).toBe(1);

    disconnectSecondClient();
    await portal.sendOfficeEvent({
      channelId: eventChannelId,
      senderId: "user_reactor",
      content: event,
    });
    expect(firstClient.read(officeChannelId, target.id)).toEqual([
      { reaction: "🎉", actorIds: ["user_reactor"] },
    ]);
    expect(portal.unreadCount(officeChannelId, "user_observer")).toBe(1);

    const reconnectedClient = createReactionProjection();
    for (const message of await portal.officeEventHistory(eventChannelId)) {
      reconnectedClient.apply(message.content);
    }
    expect(reconnectedClient.read(officeChannelId, target.id)).toEqual([
      { reaction: "🎉", actorIds: ["user_reactor"] },
    ]);
  });

  test("rejects reaction impersonation and invalid or cross-channel targets", async () => {
    const portal = createMockPortalAdapter({
      now: () => new Date("2026-07-22T12:00:00.000Z"),
    });
    const officeChannelId = "general:2026-07-22";
    const eventChannelId = "office-events:2026-07-22";
    for (const channelId of [officeChannelId, eventChannelId]) {
      await portal.ensureMembership({
        channelId,
        userId: "user_reactor",
        claims: { username: "Reactor", avatar: null },
      });
    }
    const target = await portal.sendMessage({
      channelId: officeChannelId,
      senderId: "user_reactor",
      content: { text: "Valid target" },
    });
    const event = createReactionOfficeEvent({
      mutationId: "reaction-mutation-valid",
      occurredAt: "2026-07-22T12:00:01.000Z",
      officeDay: "2026-07-22",
      officeChannelId,
      messageId: target.id,
      actorId: "user_reactor",
      reaction: "👍",
      operation: "remove",
    });

    await expect(
      portal.sendOfficeEvent({
        channelId: eventChannelId,
        senderId: "user_impersonator",
        content: event,
      }),
    ).rejects.toThrow();
    await expect(
      portal.sendOfficeEvent({
        channelId: eventChannelId,
        senderId: "user_reactor",
        content: {
          ...event,
          eventKey: "office-event:v1:reaction.changed:missing-target",
          messageId: "message-missing",
        },
      }),
    ).rejects.toThrow("target");
    await expect(
      portal.sendOfficeEvent({
        channelId: eventChannelId,
        senderId: "user_reactor",
        content: {
          ...event,
          eventKey: "office-event:v1:reaction.changed:cross-channel",
          officeChannelId: "watercooler:2026-07-22",
        },
      }),
    ).rejects.toThrow("target");
    expect(await portal.officeEventHistory(eventChannelId)).toEqual([]);
  });
});
