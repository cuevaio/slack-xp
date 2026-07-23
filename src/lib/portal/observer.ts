import type { OfficeChannelSlug } from "@/lib/portal/channels";
import {
  isNewHireMessage,
  isScriptedSystemEventMessage,
  parseOfficeChannelMessages,
} from "@/lib/portal/visible-messages";

export const OBSERVER_HISTORY_REFRESH_MS = 5_000;
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;

export type ObserverChannelMessage = {
  groupedWithPrevious: boolean;
  id: string;
  sender: string;
  timestamp: number;
  text: string;
};

type ObserverHistoryFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function isObserverChannelMessage(
  value: unknown,
): value is ObserverChannelMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "groupedWithPrevious" in value &&
    typeof value.groupedWithPrevious === "boolean" &&
    "sender" in value &&
    typeof value.sender === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    "text" in value &&
    typeof value.text === "string"
  );
}

export function projectObserverChannelHistory(
  rawMessages: readonly unknown[],
  channelId: string,
  removedMessageIds: ReadonlySet<string>,
): ObserverChannelMessage[] {
  const { messages } = parseOfficeChannelMessages(rawMessages, channelId);
  return messages.flatMap((message, index) => {
    if (removedMessageIds.has(message.id)) return [];

    const previousMessage = messages[index - 1];
    const groupedWithPrevious =
      isNewHireMessage(message) &&
      previousMessage !== undefined &&
      !removedMessageIds.has(previousMessage.id) &&
      isNewHireMessage(previousMessage) &&
      previousMessage.senderId === message.senderId &&
      message.timestamp >= previousMessage.timestamp &&
      message.timestamp - previousMessage.timestamp <= MESSAGE_GROUP_WINDOW_MS;

    return [
      {
        groupedWithPrevious,
        id: message.id,
        sender: isScriptedSystemEventMessage(message)
          ? message.character.name
          : isNewHireMessage(message)
            ? "New Hire"
            : "Portal Systems",
        timestamp: message.timestamp,
        text: message.content.text,
      },
    ];
  });
}

export async function fetchObserverChannelHistory(
  channel: OfficeChannelSlug,
  fetcher: ObserverHistoryFetcher = fetch,
  signal?: AbortSignal,
): Promise<ObserverChannelMessage[]> {
  const search = new URLSearchParams({ channel });
  const response = await fetcher(
    `/api/observer/portal/history?${search.toString()}`,
    { signal },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (
    !response.ok ||
    typeof payload !== "object" ||
    payload === null ||
    !("messages" in payload) ||
    !Array.isArray(payload.messages) ||
    !payload.messages.every(isObserverChannelMessage)
  ) {
    throw new Error("Observer history is unavailable.");
  }
  return payload.messages;
}
