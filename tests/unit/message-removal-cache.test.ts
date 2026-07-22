import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  invalidateMessageRemovals,
  messageRemovalQueryKey,
} from "@/lib/message-removals/client";

describe("Removed Message query cache", () => {
  test("invalidates every canonical channel projection and nothing unrelated", async () => {
    const queryClient = new QueryClient();
    const general = messageRemovalQueryKey("general:2026-07-22");
    const urgent = messageRemovalQueryKey("urgent:2026-07-22");
    queryClient.setQueryData(general, []);
    queryClient.setQueryData(urgent, []);
    queryClient.setQueryData(["unrelated"], "current");

    await invalidateMessageRemovals(queryClient);

    expect(queryClient.getQueryState(general)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(urgent)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  });
});
