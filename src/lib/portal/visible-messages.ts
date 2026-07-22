import {
  parseScriptedSystemEventMessage,
  type SafeScriptedSystemEventMessage,
} from "@/lib/office-days/contract";
import {
  parsePortalChatMessage,
  type SafePortalChatMessage,
} from "@/lib/portal/chat";

export type SafeOfficeChannelMessage =
  | SafePortalChatMessage
  | SafeScriptedSystemEventMessage;

export function isScriptedSystemEventMessage(
  message: SafeOfficeChannelMessage,
): message is SafeScriptedSystemEventMessage {
  return "eventKey" in message;
}

export function isNewHireMessage(
  message: SafeOfficeChannelMessage,
): message is SafePortalChatMessage {
  return !isScriptedSystemEventMessage(message);
}

export function parseOfficeChannelMessages(
  rawMessages: readonly unknown[],
  channelId: string,
): { messages: SafeOfficeChannelMessage[]; invalidCount: number } {
  const messages: SafeOfficeChannelMessage[] = [];
  const seenSystemEventKeys = new Set<string>();
  let invalidCount = 0;

  for (const rawMessage of rawMessages) {
    const newHireMessage = parsePortalChatMessage(rawMessage);
    if (newHireMessage?.channelId === channelId) {
      messages.push(newHireMessage);
      continue;
    }

    const systemEvent = parseScriptedSystemEventMessage(rawMessage, channelId);
    if (systemEvent) {
      if (!seenSystemEventKeys.has(systemEvent.eventKey)) {
        seenSystemEventKeys.add(systemEvent.eventKey);
        messages.push(systemEvent);
      }
      continue;
    }

    invalidCount += 1;
  }

  return { messages, invalidCount };
}
