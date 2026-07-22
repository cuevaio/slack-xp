import type { ChannelStatus, DetailedPresence } from "@portalsdk/core";

export const OFFICE_CHARACTER_ID_PREFIX = "office-character:";
export const OFFICE_EVENT_ID_PREFIX = "office-events:";

export function isReservedPortalIdentity(userId: string): boolean {
  return (
    userId.startsWith(OFFICE_CHARACTER_ID_PREFIX) ||
    userId.startsWith(OFFICE_EVENT_ID_PREFIX)
  );
}

export function hasCurrentRealtimeState(status: ChannelStatus): boolean {
  return status === "ready" || status === "degraded";
}

export function currentDetailedNewHireIds(
  presence: DetailedPresence | undefined,
  status: ChannelStatus,
): string[] {
  if (!hasCurrentRealtimeState(status) || !presence) {
    return [];
  }

  return [
    ...new Set(
      presence.participants
        .filter(({ id, anon }) => !anon && !isReservedPortalIdentity(id))
        .map(({ id }) => id),
    ),
  ];
}

export function currentTypingNewHireIds(
  typing: readonly string[],
  status: ChannelStatus,
): string[] {
  if (!hasCurrentRealtimeState(status)) {
    return [];
  }

  return [
    ...new Set(typing.filter((userId) => !isReservedPortalIdentity(userId))),
  ];
}

export function connectionStatusCopy(status: ChannelStatus): string {
  switch (status) {
    case "ready":
      return "";
    case "degraded":
      return "Updates may be delayed";
    case "degraded-http":
      return "Reconnecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "blocked":
      return "Unable to connect";
    case "idle":
    case "connecting":
      return "Connecting…";
  }
}
