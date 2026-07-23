import { describe, expect, test } from "bun:test";
import { planOfficeDay } from "@/lib/office-days/contract";
import {
  isAuthorizedVercelCronRequest,
  repairOfficeDayOnEntry,
} from "@/lib/office-days/cron";
import {
  flushDueSystemEvents,
  seedAndPublishOfficeDay,
} from "@/lib/office-days/service";
import type { ScriptedSystemEventPublisher } from "@/lib/office-days/types";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";
import { listOfficeChannels } from "@/lib/portal/channels";
import { createPortalScriptedSystemEventPublisher } from "@/lib/portal/server";
import { createMockPortalAdapter } from "../support/portal";

describe("Office Day seeding and publishing", () => {
  test("creates the Office Day and its deterministic plan once under concurrency", async () => {
    const repository = createInMemoryNeonRepository(
      () => new Date("2026-07-22T00:00:00.000Z"),
    );

    await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.seedOfficeDay(
          "2026-07-22",
          new Date("2026-07-22T00:00:00.000Z"),
        ),
      ),
    );

    expect(repository.officeDayCount()).toBe(1);
    expect(
      await repository.pendingSystemEvents(
        "2026-07-22",
        new Date("2026-07-22T00:00:00.000Z"),
        20,
      ),
    ).toHaveLength(planOfficeDay("2026-07-22").length);
  });

  test("marks acknowledged work, leaves a partial failure pending, and retries it", async () => {
    const now = new Date("2026-07-22T00:00:00.000Z");
    const repository = createInMemoryNeonRepository(() => now);
    const failedKey = planOfficeDay("2026-07-22")[1]?.eventKey;
    const attempts = new Map<string, number>();
    const publisher: ScriptedSystemEventPublisher = {
      async publishScriptedSystemEvent(entry) {
        const count = (attempts.get(entry.eventKey) ?? 0) + 1;
        attempts.set(entry.eventKey, count);
        if (entry.eventKey === failedKey && count === 1) {
          throw new Error("controlled partial failure");
        }
      },
    };

    const first = await seedAndPublishOfficeDay({
      officeDay: "2026-07-22",
      now,
      repository,
      publisher,
    });
    expect(first).toEqual({ planned: 5, published: 4, failed: 1 });
    expect(
      await repository.pendingSystemEvents("2026-07-22", now, 20),
    ).toHaveLength(1);

    const retry = await flushDueSystemEvents({
      officeDay: "2026-07-22",
      now,
      repository,
      publisher,
    });
    expect(retry).toEqual({ published: 1, failed: 0 });
    expect(
      await repository.pendingSystemEvents("2026-07-22", now, 20),
    ).toHaveLength(0);
    expect(attempts.get(failedKey ?? "")).toBe(2);
  });

  test("publishes through Portal as a labeled Office Character System Event", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/members")) return Response.json({ added: 1 });
        if (url.endsWith("/tokens")) {
          return Response.json({
            token: "office-character-token",
            expiresAt: "2026-07-22T00:15:00.000Z",
          });
        }
        return Response.json({ id: "system-message-1", timestamp: 1 });
      },
      { preconnect: fetch.preconnect },
    );
    const publisher = createPortalScriptedSystemEventPublisher({
      secret: "sk_portal_test",
      apiKey: "pk_portal_test",
      fetcher,
    });
    const planned = planOfficeDay("2026-07-22")[0];
    if (!planned) throw new Error("Expected a planned System Event");

    await publisher.publishScriptedSystemEvent({
      ...planned,
      attemptCount: 1,
      lastAttemptAt: planned.dueAt,
    });

    expect(requests.map(({ url }) => url)).toEqual([
      `https://api.useportal.co/v1/channels/${encodeURIComponent(planned.channelId)}/members`,
      `https://api.useportal.co/v1/channels/${encodeURIComponent(planned.channelId)}/messages`,
    ]);
    expect(JSON.parse(String(requests[0]?.init?.body))).toMatchObject({
      userId: planned.characterId,
      claims: { username: expect.stringContaining("Office Character") },
    });
    expect(JSON.parse(String(requests[1]?.init?.body))).toEqual({
      senderId: planned.characterId,
      type: "system.event",
      content: planned.event,
    });
  });

  test("requires the exact Vercel Cron bearer secret", () => {
    const request = (authorization?: string) =>
      new Request("https://example.com/api/cron/office-days", {
        headers: authorization ? { authorization } : undefined,
      });

    expect(
      isAuthorizedVercelCronRequest(
        request("Bearer cron_secret_value"),
        "cron_secret_value",
      ),
    ).toBe(true);
    expect(
      isAuthorizedVercelCronRequest(
        request("Bearer wrong"),
        "cron_secret_value",
      ),
    ).toBe(false);
    expect(isAuthorizedVercelCronRequest(request(), "cron_secret_value")).toBe(
      false,
    );
  });

  test("lazy authenticated entry repairs a missed seed and skips published work", async () => {
    const now = new Date("2026-07-22T12:00:00.000Z");
    const neon = createInMemoryNeonRepository(() => now);
    const controlledPortal = createMockPortalAdapter({ now: () => now });
    const adapters = {
      kind: "mock" as const,
      neon,
      portal: {
        ...controlledPortal,
        async listChannels(at?: Date) {
          return listOfficeChannels(at);
        },
      },
    };

    expect(await repairOfficeDayOnEntry({ adapters, now })).toEqual({
      planned: 5,
      published: 5,
      failed: 0,
    });
    expect(await repairOfficeDayOnEntry({ adapters, now })).toEqual({
      planned: 5,
      published: 0,
      failed: 0,
    });
    expect(await controlledPortal.history("general:2026-07-22")).toHaveLength(
      1,
    );
  });
});
