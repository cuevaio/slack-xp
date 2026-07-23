import { describe, expect, test } from "bun:test";
import { createReactionOfficeEvent } from "@/lib/office-events/contract";
import {
  restoreFailedChatDraft,
  setOptimisticReactionPending,
} from "@/lib/portal/optimistic-activity";

function reactionEvent(mutationId: string, operation: "add" | "remove") {
  return createReactionOfficeEvent({
    mutationId,
    occurredAt:
      operation === "add"
        ? "2026-07-23T12:00:00.000Z"
        : "2026-07-23T12:00:01.000Z",
    officeDay: "2026-07-23",
    officeChannelId: "general:2026-07-23",
    messageId: "message-1",
    actorId: "user-1",
    reaction: "👍",
    operation,
  });
}

describe("optimistic realtime activity", () => {
  test("restores a failed message without replacing a newer draft", () => {
    expect(restoreFailedChatDraft("First message", "")).toBe("First message");
    expect(restoreFailedChatDraft("First message", "New draft")).toBe(
      "First message\nNew draft",
    );
  });

  test("adds, deduplicates, and rolls back one optimistic reaction", () => {
    const added = reactionEvent("reaction-add", "add");
    const removed = reactionEvent("reaction-remove", "remove");

    const withAdded = setOptimisticReactionPending([], added, true);
    const withBoth = setOptimisticReactionPending(withAdded, removed, true);

    expect(setOptimisticReactionPending(withAdded, added, true)).toEqual([
      added,
    ]);
    expect(withBoth).toEqual([added, removed]);
    expect(setOptimisticReactionPending(withBoth, added, false)).toEqual([
      removed,
    ]);
  });
});
