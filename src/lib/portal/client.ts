import { officeEventChannelIdForDay } from "@/lib/office-events/contract";
import { listOfficeChannelsForDay } from "@/lib/portal/channels";

type FetchPortalToken = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type PortalTokenSourceOptions = {
  expectedOfficeDay: string;
  fetcher?: FetchPortalToken;
  onOfficeDayExpired?(): void;
};

function hasExpectedOfficeChannels(
  payload: Record<string, unknown>,
  expectedOfficeDay: string,
): boolean {
  const channelIds = payload.channelIds;
  if (!Array.isArray(channelIds)) return false;
  const expectedChannelIds = listOfficeChannelsForDay(expectedOfficeDay).map(
    ({ id }) => id,
  );
  return (
    channelIds.length === expectedChannelIds.length &&
    expectedChannelIds.every((channelId) => channelIds.includes(channelId)) &&
    payload.eventChannelId === officeEventChannelIdForDay(expectedOfficeDay)
  );
}

export function createPortalTokenSource({
  expectedOfficeDay,
  fetcher = fetch,
  onOfficeDayExpired,
}: PortalTokenSourceOptions): () => Promise<string> {
  return async () => {
    const response = await fetcher("/api/office/portal/token", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || typeof payload !== "object" || payload === null) {
      throw new Error("Portal authentication is temporarily unavailable.");
    }
    const tokenPayload = payload as Record<string, unknown>;
    if (!hasExpectedOfficeChannels(tokenPayload, expectedOfficeDay)) {
      onOfficeDayExpired?.();
      throw new Error("This Office Day has ended. Continue to reconnect.");
    }
    if (typeof tokenPayload.token !== "string") {
      throw new Error("Portal authentication is temporarily unavailable.");
    }
    return tokenPayload.token;
  };
}
