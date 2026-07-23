import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import {
  fetchMessageRemovals,
  invalidateMessageRemovals,
  messageRemovalQueryKey,
  messageRemovalQueryOptions,
} from "@/lib/message-removals/client";

describe("Removed Message query cache", () => {
  test("retries and accelerates repair after projection errors", () => {
    const options = messageRemovalQueryOptions("general:2026-07-22");

    expect(options.retry).toBeGreaterThan(0);
    expect(typeof options.retryDelay).toBe("function");
    expect(typeof options.refetchInterval).toBe("function");
  });

  test("rejects projections for a different Office Channel", async () => {
    const fetcher = async () =>
      Response.json({
        removals: [
          {
            removalId: "removal_1",
            officeDay: "2026-07-22",
            officeChannelId: "urgent:2026-07-22",
            messageId: "message_1",
            removedAt: "2026-07-22T12:00:00.000Z",
          },
        ],
      });

    expect(fetchMessageRemovals("general:2026-07-22", fetcher)).rejects.toThrow(
      "unavailable",
    );
  });

  test("invalidates every canonical channel projection and nothing unrelated", async () => {
    const queryClient = new QueryClient();
    const general = messageRemovalQueryKey("general:2026-07-22");
    const urgent = messageRemovalQueryKey("urgent:2026-07-22");
    queryClient.setQueryData(general, []);
    queryClient.setQueryData(urgent, []);
    queryClient.setQueryData(["unrelated"], "current");

    await invalidateMessageRemovals(queryClient);

    expect(queryClient.getQueryData<unknown[]>(general)).toEqual([]);
    expect(queryClient.getQueryData<unknown[]>(urgent)).toEqual([]);
    expect(queryClient.getQueryState(general)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(urgent)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(false);
  });
});
