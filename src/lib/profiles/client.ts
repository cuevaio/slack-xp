"use client";

import {
  type QueryClient,
  queryOptions,
  useQuery,
} from "@tanstack/react-query";
import type { ProfileAttribution } from "@/lib/profiles/types";

export const PROFILE_REPAIR_INTERVAL_MS = 30_000;
const PROFILE_QUERY_NAMESPACE = "new-hire-profiles";

type ProfileFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

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
    (profile.status === "current" ||
      profile.status === "former" ||
      profile.status === "unavailable")
  );
}

export async function fetchProfileAttributions(
  clerkUserIds: readonly string[],
  fetcher: ProfileFetcher = fetch,
): Promise<ProfileAttribution[]> {
  const stableIds = stableProfileIds(clerkUserIds);
  if (stableIds.length === 0) return [];

  const response = await fetcher("/api/office/profiles", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clerkUserIds: stableIds }),
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

  const requestedIds = new Set(stableIds);
  return payload.profiles.filter(({ clerkUserId }) =>
    requestedIds.has(clerkUserId),
  );
}

export function profileBatchQueryOptions(clerkUserIds: readonly string[]) {
  const queryKey = profileBatchQueryKey(clerkUserIds);
  return queryOptions({
    queryKey,
    queryFn: () => fetchProfileAttributions(queryKey[1]),
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
