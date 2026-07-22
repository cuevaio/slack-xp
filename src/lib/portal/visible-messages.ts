import type { SafePublicSendHomeSystemEventMessage } from "@/lib/employment/contract";
import { parsePublicSendHomeSystemEventMessage } from "@/lib/employment/domain";
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
  | SafeScriptedSystemEventMessage
  | SafePublicSendHomeSystemEventMessage;

export function isScriptedSystemEventMessage(
  message: SafeOfficeChannelMessage,
): message is SafeScriptedSystemEventMessage {
  return "character" in message;
}

export function isPublicSendHomeSystemEventMessage(
  message: SafeOfficeChannelMessage,
): message is SafePublicSendHomeSystemEventMessage {
  return "operatorId" in message;
}

export function isNewHireMessage(
  message: SafeOfficeChannelMessage,
): message is SafePortalChatMessage {
  return (
    !isScriptedSystemEventMessage(message) &&
    !isPublicSendHomeSystemEventMessage(message)
  );
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

    const sendHomeEvent = parsePublicSendHomeSystemEventMessage(
      rawMessage,
      channelId,
    );
    if (sendHomeEvent) {
      if (!seenSystemEventKeys.has(sendHomeEvent.eventKey)) {
        seenSystemEventKeys.add(sendHomeEvent.eventKey);
        messages.push(sendHomeEvent);
      }
      continue;
    }

    invalidCount += 1;
  }

  return { messages, invalidCount };
}
