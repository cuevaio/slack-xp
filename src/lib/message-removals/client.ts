"use client";

import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import type { SerializedMessageRemovalProjection } from "@/lib/message-removals/contract";

const MESSAGE_REMOVAL_QUERY_NAMESPACE = "message-removals";
export const MESSAGE_REMOVAL_REPAIR_INTERVAL_MS = 30_000;

export function messageRemovalQueryKey(officeChannelId: string) {
  return [MESSAGE_REMOVAL_QUERY_NAMESPACE, officeChannelId] as const;
}

function isRemoval(
  value: unknown,
): value is SerializedMessageRemovalProjection {
  if (typeof value !== "object" || value === null) return false;
  const removal = value as Partial<SerializedMessageRemovalProjection>;
  const removedAt =
    typeof removal.removedAt === "string" ? new Date(removal.removedAt) : null;
  return (
    typeof removal.removalId === "string" &&
    typeof removal.officeDay === "string" &&
    typeof removal.officeChannelId === "string" &&
    typeof removal.messageId === "string" &&
    removedAt !== null &&
    Number.isFinite(removedAt.getTime()) &&
    removedAt.toISOString() === removal.removedAt
  );
}

export async function fetchMessageRemovals(
  officeChannelId: string,
  fetcher: typeof fetch = fetch,
): Promise<SerializedMessageRemovalProjection[]> {
  const search = new URLSearchParams({ officeChannelId });
  const response = await fetcher(
    `/api/office/message-removals?${search.toString()}`,
    { credentials: "include", cache: "no-store" },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("removals" in payload) ||
    !Array.isArray(payload.removals) ||
    !payload.removals.every(isRemoval)
  ) {
    throw new Error("Removed Message projections are unavailable.");
  }
  return payload.removals.filter(
    (removal) => removal.officeChannelId === officeChannelId,
  );
}

export function messageRemovalQueryOptions(officeChannelId: string) {
  return queryOptions({
    queryKey: messageRemovalQueryKey(officeChannelId),
    queryFn: () => fetchMessageRemovals(officeChannelId),
    staleTime: MESSAGE_REMOVAL_REPAIR_INTERVAL_MS,
    refetchInterval: MESSAGE_REMOVAL_REPAIR_INTERVAL_MS,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}

export function useMessageRemovals(officeChannelId: string) {
  return useQuery(messageRemovalQueryOptions(officeChannelId));
}

export function invalidateMessageRemovals(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: [MESSAGE_REMOVAL_QUERY_NAMESPACE],
  });
}

export async function submitMessageRemoval({
  officeChannelId,
  messageId,
  privateReason,
  fetcher = fetch,
}: {
  officeChannelId: string;
  messageId: string;
  privateReason: string;
  fetcher?: typeof fetch;
}): Promise<SerializedMessageRemovalProjection> {
  const response = await fetcher("/api/office/operator/message-removals", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officeChannelId, messageId, privateReason }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("removal" in payload) ||
    !isRemoval(payload.removal)
  ) {
    throw new Error("The message could not be removed.");
  }
  return payload.removal;
}
