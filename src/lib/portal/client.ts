import { officeEventChannelIdForDay } from "@/lib/office-events/contract";
import { listOfficeChannelsForDay } from "@/lib/portal/channels";
import { SAFETY_PROJECTION_TIMEOUT_MS } from "@/lib/safety/contract";

type FetchPortalToken = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type PortalTokenSourceOptions = {
  expectedOfficeDay: string;
  fetcher?: FetchPortalToken;
  getAuthorizationToken?(): Promise<string | null>;
  onOfficeDayExpired?(): void;
};

function hasExpectedOfficeChannels(
  payload: object,
  expectedOfficeDay: string,
): boolean {
  const channelIds = "channelIds" in payload ? payload.channelIds : undefined;
  if (!Array.isArray(channelIds)) return false;
  const expectedChannelIds = listOfficeChannelsForDay(expectedOfficeDay).map(
    ({ id }) => id,
  );
  return (
    channelIds.length === expectedChannelIds.length &&
    expectedChannelIds.every((channelId) => channelIds.includes(channelId)) &&
    "eventChannelId" in payload &&
    payload.eventChannelId === officeEventChannelIdForDay(expectedOfficeDay)
  );
}

export function createPortalTokenSource({
  expectedOfficeDay,
  fetcher = fetch,
  getAuthorizationToken,
  onOfficeDayExpired,
}: PortalTokenSourceOptions): () => Promise<string> {
  return async () => {
    const authorizationToken = await getAuthorizationToken?.();
    if (getAuthorizationToken && !authorizationToken) {
      throw new Error("Portal authentication is temporarily unavailable.");
    }
    const response = await fetcher("/api/office/portal/token", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: authorizationToken
        ? { Authorization: `Bearer ${authorizationToken}` }
        : undefined,
      signal: AbortSignal.timeout(SAFETY_PROJECTION_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || typeof payload !== "object" || payload === null) {
      throw new Error("Portal authentication is temporarily unavailable.");
    }
    if (!hasExpectedOfficeChannels(payload, expectedOfficeDay)) {
      onOfficeDayExpired?.();
      throw new Error("This Office Day has ended. Continue to reconnect.");
    }
    if (!("token" in payload) || typeof payload.token !== "string") {
      throw new Error("Portal authentication is temporarily unavailable.");
    }
    return payload.token;
  };
}
