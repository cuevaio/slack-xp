import type {
  SafePublicSendHomeSystemEventMessage,
  SafePublicTerminationSystemEventMessage,
} from "@/lib/employment/contract";
import {
  parsePublicSendHomeSystemEventMessage,
  parsePublicTerminationSystemEventMessage,
} from "@/lib/employment/domain";
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
  | SafePublicSendHomeSystemEventMessage
  | SafePublicTerminationSystemEventMessage;

export function isScriptedSystemEventMessage(
  message: SafeOfficeChannelMessage,
): message is SafeScriptedSystemEventMessage {
  return "character" in message;
}

export function isPublicSendHomeSystemEventMessage(
  message: SafeOfficeChannelMessage,
): message is SafePublicSendHomeSystemEventMessage {
  return "operatorId" in message && "expiresAt" in message.content;
}

export function isPublicTerminationSystemEventMessage(
  message: SafeOfficeChannelMessage,
): message is SafePublicTerminationSystemEventMessage {
  return "operatorId" in message && "terminationId" in message;
}

export function isNewHireMessage(
  message: SafeOfficeChannelMessage,
): message is SafePortalChatMessage {
  return (
    !isScriptedSystemEventMessage(message) &&
    !isPublicSendHomeSystemEventMessage(message) &&
    !isPublicTerminationSystemEventMessage(message)
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

    const terminationEvent = parsePublicTerminationSystemEventMessage(
      rawMessage,
      channelId,
    );
    if (terminationEvent) {
      if (!seenSystemEventKeys.has(terminationEvent.eventKey)) {
        seenSystemEventKeys.add(terminationEvent.eventKey);
        messages.push(terminationEvent);
      }
      continue;
    }

    invalidCount += 1;
  }

  return { messages, invalidCount };
}
