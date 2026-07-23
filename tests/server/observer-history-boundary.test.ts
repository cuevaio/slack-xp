import { describe, expect, test } from "bun:test";
import { handleObserverHistoryRequest } from "@/app/api/observer/portal/history/route";
import type { MessageRemovalProjection } from "@/lib/message-removals/contract";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const now = new Date("2026-07-22T13:00:00.000Z");

function portalMessage(id: string, text: string) {
  return {
    id,
    channelId: "general:2026-07-22",
    sender: { id: "user_sender", anon: false },
    timestamp: 1_753_184_800_000,
    kind: "text",
    type: "message",
    ephemeral: false,
    retracted: false,
    status: "sent",
    content: { text },
  };
}

describe("public Observer history boundary", () => {
  test("returns only projected current-day messages and omits removals", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    repository.listMessageRemovals = async () => [
      {
        removalId: "removal-observer-hidden",
        officeDay: "2026-07-22",
        officeChannelId: "general:2026-07-22",
        messageId: "message-hidden",
        removedAt: now,
      } satisfies MessageRemovalProjection,
    ];
    const response = await handleObserverHistoryRequest(
      new Request(
        "https://office.example.com/api/observer/portal/history?channel=general",
      ),
      {
        repository,
        portal: {
          async readChannelHistory() {
            return [
              portalMessage("message-visible", "Visible update"),
              portalMessage("message-hidden", "Private removed body"),
              { unsafe: true },
            ];
          },
        },
      },
      now,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=3, stale-while-revalidate=6",
    );
    expect(await response.json()).toEqual({
      channelId: "general:2026-07-22",
      messages: [
        {
          groupedWithPrevious: false,
          id: "message-visible",
          sender: "New Hire",
          timestamp: 1_753_184_800_000,
          text: "Visible update",
        },
      ],
    });
  });

  test("rejects arbitrary channel ids before calling dependencies", async () => {
    let calls = 0;
    const repository = createInMemoryNeonRepository(() => now);
    repository.listMessageRemovals = async () => {
      calls += 1;
      return [];
    };
    const response = await handleObserverHistoryRequest(
      new Request(
        "https://office.example.com/api/observer/portal/history?channel=office-events",
      ),
      {
        repository,
        portal: {
          async readChannelHistory() {
            calls += 1;
            return [];
          },
        },
      },
      now,
    );

    expect(response.status).toBe(422);
    expect(calls).toBe(0);
  });

  test("fails closed when either safety dependency is unavailable", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const logs: unknown[] = [];
    repository.listMessageRemovals = async () => new Promise(() => {});
    const response = await handleObserverHistoryRequest(
      new Request(
        "https://office.example.com/api/observer/portal/history?channel=general",
        { headers: { "x-request-id": "observer-history-test" } },
      ),
      {
        repository,
        portal: {
          async readChannelHistory() {
            return [];
          },
        },
      },
      now,
      { timeoutMs: 1, logger: (entry) => logs.push(entry) },
    );

    expect(response.status).toBe(503);
    expect(logs).toEqual([
      {
        operation: "observer_history",
        correlationId: "observer-history-test",
        authority: "neon",
        status: "unavailable",
        officeChannelId: "general:2026-07-22",
      },
    ]);
  });
});
