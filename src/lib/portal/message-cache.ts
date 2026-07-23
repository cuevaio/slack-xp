import { parseOfficeChannelMessages } from "@/lib/portal/visible-messages";

const CACHE_VERSION = 1;
const CACHE_PREFIX = "portal-messenger:channel-messages";
const QUERY_NAMESPACE = "portal-channel-messages";
export const CACHED_MESSAGE_LIMIT = 50;

type MessageStorage = Pick<Storage, "getItem" | "setItem">;

function cacheKey(channelId: string): string {
  return `${CACHE_PREFIX}:v${CACHE_VERSION}:${channelId}`;
}

export function channelMessageQueryKey(channelId: string) {
  return [QUERY_NAMESPACE, channelId] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function readCachedChannelMessages(
  storage: MessageStorage,
  channelId: string,
): unknown[] {
  try {
    const raw = storage.getItem(cacheKey(channelId));
    if (!raw) return [];

    const snapshot: unknown = JSON.parse(raw);
    if (
      !isRecord(snapshot) ||
      snapshot.version !== CACHE_VERSION ||
      snapshot.channelId !== channelId ||
      !Array.isArray(snapshot.messages)
    ) {
      return [];
    }

    return snapshot.messages
      .slice(-CACHED_MESSAGE_LIMIT)
      .filter(
        (message) =>
          parseOfficeChannelMessages([message], channelId).messages.length ===
          1,
      );
  } catch {
    return [];
  }
}

export function writeCachedChannelMessages(
  storage: MessageStorage,
  channelId: string,
  messages: readonly unknown[],
): void {
  try {
    const safeMessages = messages
      .filter(
        (message) =>
          parseOfficeChannelMessages([message], channelId).messages.length ===
          1,
      )
      .slice(-CACHED_MESSAGE_LIMIT);
    storage.setItem(
      cacheKey(channelId),
      JSON.stringify({
        version: CACHE_VERSION,
        channelId,
        messages: safeMessages,
      }),
    );
  } catch {
    // Storage can be disabled or full; Portal remains the authoritative fallback.
  }
}
