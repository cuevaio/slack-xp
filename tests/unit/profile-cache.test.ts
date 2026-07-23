import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  invalidateProfileBatches,
  PROFILE_REPAIR_INTERVAL_MS,
  profileBatchQueryKey,
} from "@/lib/profiles/client";

describe("New Hire Profile query cache", () => {
  test("uses sorted, deduplicated batch keys", () => {
    expect(profileBatchQueryKey(["user_z", "user_a", "user_z"])).toEqual([
      "new-hire-profiles",
      ["user_a", "user_z"],
    ]);
    expect(profileBatchQueryKey(["user_a", "user_z"])).toEqual(
      profileBatchQueryKey(["user_z", "user_a"]),
    );
  });

  test("invalidates only batches containing the affected stable ID", async () => {
    const queryClient = new QueryClient();
    const affectedSingle = profileBatchQueryKey(["user_a"]);
    const affectedHistory = profileBatchQueryKey(["user_a", "user_b"]);
    const unaffected = profileBatchQueryKey(["user_b"]);
    queryClient.setQueryData(affectedSingle, []);
    queryClient.setQueryData(affectedHistory, []);
    queryClient.setQueryData(unaffected, []);

    await invalidateProfileBatches(queryClient, "user_a");

    expect(queryClient.getQueryState(affectedSingle)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(affectedHistory)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(unaffected)?.isInvalidated).toBe(false);
  });

  test("keeps a bounded normal repair interval for missed signals", () => {
    expect(PROFILE_REPAIR_INTERVAL_MS).toBeGreaterThanOrEqual(15_000);
    expect(PROFILE_REPAIR_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  test("repairs two connected caches without allowing reordered hints to restore old values", async () => {
    let displayName = "Pat Pending";
    const createConnectedClient = async (ids: readonly string[]) => {
      const client = new QueryClient();
      const observer = new QueryObserver(client, {
        queryKey: profileBatchQueryKey(ids),
        queryFn: async () =>
          ids.map((clerkUserId) => ({
            clerkUserId,
            displayName:
              clerkUserId === "user_a" ? displayName : "Unaffected Hire",
            imageUrl: null,
            status: "current" as const,
          })),
        staleTime: 0,
      });
      const unsubscribe = observer.subscribe(() => {});
      await observer.refetch();
      return { client, unsubscribe };
    };
    const liveMessages = await createConnectedClient(["user_a"]);
    const historicalAndPresence = await createConnectedClient([
      "user_a",
      "user_b",
    ]);
    const unrelated = await createConnectedClient(["user_b"]);

    displayName = "Taylor Byte";
    await Promise.all([
      invalidateProfileBatches(liveMessages.client, "user_a"),
      invalidateProfileBatches(historicalAndPresence.client, "user_a"),
      invalidateProfileBatches(unrelated.client, "user_a"),
    ]);

    expect(
      liveMessages.client.getQueryData<[{ displayName: string }]>(
        profileBatchQueryKey(["user_a"]),
      )?.[0]?.displayName,
    ).toBe("Taylor Byte");
    expect(
      historicalAndPresence.client.getQueryData<Array<{ displayName: string }>>(
        profileBatchQueryKey(["user_a", "user_b"]),
      )?.[0]?.displayName,
    ).toBe("Taylor Byte");
    expect(
      unrelated.client.getQueryData<Array<{ displayName: string }>>(
        profileBatchQueryKey(["user_b"]),
      )?.[0]?.displayName,
    ).toBe("Unaffected Hire");

    // A delayed or duplicate hint can only fetch the current canonical value.
    await invalidateProfileBatches(liveMessages.client, "user_a");
    expect(
      liveMessages.client.getQueryData<Array<{ displayName: string }>>(
        profileBatchQueryKey(["user_a"]),
      )?.[0]?.displayName,
    ).toBe("Taylor Byte");

    // Normal active-query repair converges even when no signal arrives.
    displayName = "Alex Current";
    await historicalAndPresence.client.refetchQueries({ type: "active" });
    expect(
      historicalAndPresence.client.getQueryData<Array<{ displayName: string }>>(
        profileBatchQueryKey(["user_a", "user_b"]),
      )?.[0]?.displayName,
    ).toBe("Alex Current");

    liveMessages.unsubscribe();
    historicalAndPresence.unsubscribe();
    unrelated.unsubscribe();
  });

  test("refreshes live and historical attribution to Former Employee", async () => {
    let deleted = false;
    const connect = async () => {
      const client = new QueryClient();
      const queryKey = profileBatchQueryKey(["user_deleted"]);
      const observer = new QueryObserver(client, {
        queryKey,
        queryFn: async () => [
          deleted
            ? {
                clerkUserId: "user_deleted",
                displayName: "Former Employee",
                imageUrl: null,
                status: "former" as const,
              }
            : {
                clerkUserId: "user_deleted",
                displayName: "Private Person",
                imageUrl: "https://img.example/private.png",
                status: "current" as const,
              },
        ],
        staleTime: 0,
      });
      const unsubscribe = observer.subscribe(() => {});
      await observer.refetch();
      return { client, queryKey, unsubscribe };
    };
    const live = await connect();
    const historical = await connect();

    deleted = true;
    await Promise.all([
      invalidateProfileBatches(live.client, "user_deleted"),
      invalidateProfileBatches(historical.client, "user_deleted"),
    ]);

    for (const connection of [live, historical]) {
      expect(
        connection.client.getQueryData<
          Array<{
            displayName: string;
            imageUrl: string | null;
            status: string;
          }>
        >(connection.queryKey),
      ).toEqual([
        expect.objectContaining({
          displayName: "Former Employee",
          imageUrl: null,
          status: "former",
        }),
      ]);
      connection.unsubscribe();
    }
  });
});
