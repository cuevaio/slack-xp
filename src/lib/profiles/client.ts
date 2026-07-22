"use client";

import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import type { ProfileAttribution } from "@/lib/profiles/types";

export const PROFILE_REPAIR_INTERVAL_MS = 30_000;
const PROFILE_QUERY_NAMESPACE = "new-hire-profiles";

export type ProfileBatchQueryKey = readonly [
  typeof PROFILE_QUERY_NAMESPACE,
  readonly string[],
];

function stableProfileIds(clerkUserIds: readonly string[]): string[] {
  return [...new Set(clerkUserIds)].sort();
}

export function profileBatchQueryKey(
  clerkUserIds: readonly string[],
): ProfileBatchQueryKey {
  return [PROFILE_QUERY_NAMESPACE, stableProfileIds(clerkUserIds)] as const;
}

function isProfileAttribution(value: unknown): value is ProfileAttribution {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Partial<ProfileAttribution>;
  return (
    typeof profile.clerkUserId === "string" &&
    typeof profile.displayName === "string" &&
    (profile.imageUrl === null || typeof profile.imageUrl === "string") &&
    (profile.status === "current" || profile.status === "unavailable")
  );
}

async function fetchProfileBatch(
  clerkUserIds: readonly string[],
): Promise<ProfileAttribution[]> {
  if (clerkUserIds.length === 0) return [];
  const response = await fetch("/api/office/profiles", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clerkUserIds }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("profiles" in payload) ||
    !Array.isArray(payload.profiles) ||
    !payload.profiles.every(isProfileAttribution)
  ) {
    throw new Error("New Hire Profiles are unavailable.");
  }
  return payload.profiles;
}

export function profileBatchQueryOptions(clerkUserIds: readonly string[]) {
  const queryKey = profileBatchQueryKey(clerkUserIds);
  return queryOptions({
    queryKey,
    queryFn: () => fetchProfileBatch(queryKey[1]),
    staleTime: PROFILE_REPAIR_INTERVAL_MS,
    refetchInterval: PROFILE_REPAIR_INTERVAL_MS,
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
}

export function useProfileBatch(clerkUserIds: readonly string[]) {
  return useQuery(profileBatchQueryOptions(clerkUserIds));
}

function isProfileBatchQueryKey(
  value: readonly unknown[],
): value is readonly [
  typeof PROFILE_QUERY_NAMESPACE,
  readonly string[],
  ...unknown[],
] {
  return (
    value[0] === PROFILE_QUERY_NAMESPACE &&
    Array.isArray(value[1]) &&
    value[1].every((item) => typeof item === "string")
  );
}

export function invalidateProfileBatches(
  queryClient: QueryClient,
  clerkUserId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    predicate: (query) =>
      isProfileBatchQueryKey(query.queryKey) &&
      query.queryKey[1].includes(clerkUserId),
  });
}
