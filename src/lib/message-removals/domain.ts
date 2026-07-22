import {
  MESSAGE_REMOVAL_PRIVATE_REASON_MAX_LENGTH,
  type MessageRemovalRequest,
} from "@/lib/message-removals/contract";
import { listOfficeChannelsForDay } from "@/lib/portal/channels";
import { isOfficeDay } from "@/lib/portal/office-day";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function isMessageRemovalOfficeChannel(
  officeChannelId: unknown,
  officeDay: string,
): officeChannelId is string {
  return (
    isOfficeDay(officeDay) &&
    typeof officeChannelId === "string" &&
    listOfficeChannelsForDay(officeDay).some(
      (channel) => channel.id === officeChannelId,
    )
  );
}

export function parseMessageRemovalRequest(
  value: unknown,
  officeDay: string,
): MessageRemovalRequest | null {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 3 ||
    !isMessageRemovalOfficeChannel(value.officeChannelId, officeDay) ||
    !isIdentifier(value.messageId) ||
    typeof value.privateReason !== "string"
  ) {
    return null;
  }
  const privateReason = value.privateReason.trim();
  if (
    privateReason.length === 0 ||
    privateReason.length > MESSAGE_REMOVAL_PRIVATE_REASON_MAX_LENGTH
  ) {
    return null;
  }
  return {
    officeChannelId: value.officeChannelId,
    messageId: value.messageId,
    privateReason,
  };
}

export function parseMessageRemovalChannelQuery(
  value: unknown,
  officeDay: string,
): string | null {
  return isMessageRemovalOfficeChannel(value, officeDay) ? value : null;
}
