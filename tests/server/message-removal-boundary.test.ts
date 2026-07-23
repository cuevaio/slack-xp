import { describe, expect, test } from "bun:test";
import { handleMessageRemovalQuery } from "@/app/api/office/message-removals/route";
import { handleOperatorMessageRemovalRequest } from "@/app/api/office/operator/message-removals/route";
import type { MessageRemovalInvalidationEvent } from "@/lib/message-removals/contract";
import { createInMemoryNeonRepository } from "@/lib/onboarding/memory";

const now = new Date("2026-07-22T13:00:00.000Z");

function removalRequest(privateReason = "Confirmed policy violation") {
  return new Request(
    "https://office.example.com/api/office/operator/message-removals",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        officeChannelId: "general:2026-07-22",
        messageId: "message-boundary-removal",
        privateReason,
      }),
    },
  );
}

describe("Operator Removed Message boundary", () => {
  test("times out closed without logging conversation or private review content", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const logs: unknown[] = [];
    repository.listMessageRemovals = async () => new Promise(() => {});
    const response = await handleMessageRemovalQuery(
      new Request(
        "https://office.example.com/api/office/message-removals?officeChannelId=general%3A2026-07-22",
        { headers: { "x-request-id": "removal-safety-test" } },
      ),
      repository,
      now,
      { timeoutMs: 1, logger: (entry) => logs.push(entry) },
    );

    expect(response.status).toBe(503);
    expect(logs).toEqual([
      {
        operation: "message_removal_projection",
        correlationId: "removal-safety-test",
        authority: "neon",
        status: "unavailable",
        officeChannelId: "general:2026-07-22",
      },
    ]);
    expect(JSON.stringify(logs)).not.toMatch(/conversation|private review/i);
  });

  test("rejects non-Operators and rechecks a revoked allowlist before mutation", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const publisher = { async publishMessageRemovalInvalidation() {} };
    for (const requesterId of ["user_attacker", "user_revoked_operator"]) {
      const response = await handleOperatorMessageRemovalRequest(
        removalRequest(),
        {
          repository,
          publisher,
          requesterId,
          operatorUserIds: "user_operator",
          now,
        },
      );
      expect(response.status).toBe(403);
    }
    expect(repository.messageRemovalRecords()).toEqual([]);
    expect(repository.operatorActionRecords()).toEqual([]);
  });

  test("requires a private reason and publishes no private values", async () => {
    const repository = createInMemoryNeonRepository(() => now);
    const invalidations: MessageRemovalInvalidationEvent[] = [];
    const dependencies = {
      repository,
      publisher: {
        async publishMessageRemovalInvalidation(
          event: MessageRemovalInvalidationEvent,
        ) {
          invalidations.push(event);
        },
      },
      requesterId: "user_operator",
      operatorUserIds: "user_operator",
      now,
    };
    expect(
      (
        await handleOperatorMessageRemovalRequest(
          removalRequest("   "),
          dependencies,
        )
      ).status,
    ).toBe(422);

    const removed = await handleOperatorMessageRemovalRequest(
      removalRequest("Confirmed policy violation"),
      dependencies,
    );
    expect(removed.status).toBe(201);
    const payload = await removed.json();
    expect(payload).toMatchObject({
      status: "removed",
      removal: { messageId: "message-boundary-removal" },
      invalidationStatus: "sent",
    });
    expect(JSON.stringify(payload)).not.toMatch(/policy violation|operator/i);
    expect(JSON.stringify(invalidations)).not.toMatch(/policy violation/i);
  });
});
