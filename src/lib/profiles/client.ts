import type { ProfileAttribution } from "@/lib/profiles/types";

type ProfileFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isProfileAttribution(value: unknown): value is ProfileAttribution {
  if (!value || typeof value !== "object") {
    return false;
  }

  return (
    "clerkUserId" in value &&
    typeof value.clerkUserId === "string" &&
    "displayName" in value &&
    typeof value.displayName === "string" &&
    "imageUrl" in value &&
    (value.imageUrl === null || typeof value.imageUrl === "string") &&
    "status" in value &&
    (value.status === "current" || value.status === "unavailable")
  );
}

export async function fetchProfileAttributions(
  clerkUserIds: readonly string[],
  fetcher: ProfileFetcher = fetch,
): Promise<ProfileAttribution[]> {
  if (clerkUserIds.length === 0) {
    return [];
  }

  const response = await fetcher("/api/office/profiles", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clerkUserIds }),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    !payload ||
    typeof payload !== "object" ||
    !("profiles" in payload) ||
    !Array.isArray(payload.profiles) ||
    !payload.profiles.every(isProfileAttribution)
  ) {
    throw new Error("New Hire Profiles are temporarily unavailable.");
  }

  const requestedIds = new Set(clerkUserIds);
  return payload.profiles.filter(({ clerkUserId }) =>
    requestedIds.has(clerkUserId),
  );
}
