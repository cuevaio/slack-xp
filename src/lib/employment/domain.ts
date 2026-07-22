import {
  EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
  EMPLOYMENT_SYSTEM_EVENT_VERSION,
  type EmploymentAccessDecision,
  type PublicSendHomeSystemEvent,
  type SafePublicSendHomeSystemEventMessage,
  SEND_HOME_PRIVATE_REASON_MAX_LENGTH,
  type SendHomeRequest,
} from "@/lib/employment/contract";
import { OFFICE_EVENT_SENDERS } from "@/lib/office-events/contract";
import { isOfficeDay, officeDay } from "@/lib/portal/office-day";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const MILLISECONDS_PER_DAY = 86_400_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEmploymentIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function officeDayExpiry(now: Date = new Date()): Date {
  const currentOfficeDay = officeDay(now);
  return new Date(
    Date.parse(`${currentOfficeDay}T00:00:00.000Z`) + MILLISECONDS_PER_DAY,
  );
}

export function employmentAccessDecision({
  now,
  sentHomeUntil,
  terminatedAt,
  deletedAt,
}: {
  now: Date;
  sentHomeUntil: Date | null;
  terminatedAt: Date | null;
  deletedAt: Date | null;
}): EmploymentAccessDecision {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("A valid instant is required for employment access.");
  }
  if (deletedAt) {
    return { eligible: false, reason: "deleted", until: null };
  }
  if (terminatedAt) {
    return { eligible: false, reason: "terminated", until: null };
  }
  if (sentHomeUntil && sentHomeUntil.getTime() > now.getTime()) {
    return {
      eligible: false,
      reason: "sent-home",
      until: new Date(sentHomeUntil),
    };
  }
  return { eligible: true, reason: null, until: null };
}

export function parseSendHomeRequest(value: unknown): SendHomeRequest | null {
  if (!isObject(value)) return null;
  const keys = Object.keys(value);
  if (
    keys.some(
      (key) =>
        key !== "requestId" &&
        key !== "targetNewHireId" &&
        key !== "privateReason" &&
        key !== "reportId",
    ) ||
    !isEmploymentIdentifier(value.requestId) ||
    !isEmploymentIdentifier(value.targetNewHireId) ||
    typeof value.privateReason !== "string" ||
    (value.reportId !== undefined && !isEmploymentIdentifier(value.reportId))
  ) {
    return null;
  }
  const privateReason = value.privateReason.trim();
  if (
    privateReason.length === 0 ||
    privateReason.length > SEND_HOME_PRIVATE_REASON_MAX_LENGTH
  ) {
    return null;
  }
  return {
    requestId: value.requestId,
    targetNewHireId: value.targetNewHireId,
    privateReason,
    ...(typeof value.reportId === "string" ? { reportId: value.reportId } : {}),
  };
}

export function createSendHomeSystemEventKey(
  currentOfficeDay: string,
  actionId: string,
): string {
  if (!isOfficeDay(currentOfficeDay) || !isEmploymentIdentifier(actionId)) {
    throw new TypeError(
      "A valid Send Home action and Office Day are required.",
    );
  }
  return `employment-event:v1:${currentOfficeDay}:${actionId}`;
}

export function parsePublicSendHomeSystemEventMessage(
  value: unknown,
  expectedChannelId: string,
): SafePublicSendHomeSystemEventMessage | null {
  if (
    !isObject(value) ||
    !isEmploymentIdentifier(value.id) ||
    value.channelId !== expectedChannelId ||
    !expectedChannelId.startsWith("all-hands:") ||
    !isObject(value.sender) ||
    value.sender.id !== OFFICE_EVENT_SENDERS.operations ||
    value.sender.anon !== false ||
    typeof value.timestamp !== "number" ||
    !Number.isSafeInteger(value.timestamp) ||
    value.timestamp < 0 ||
    value.kind !== "text" ||
    value.type !== EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE ||
    value.ephemeral !== false ||
    value.retracted !== false ||
    value.status !== "sent" ||
    !isObject(value.content)
  ) {
    return null;
  }
  const content = value.content;
  const keys = Object.keys(content);
  const expiry =
    typeof content.expiresAt === "string" ? new Date(content.expiresAt) : null;
  if (
    keys.length !== 8 ||
    content.version !== EMPLOYMENT_SYSTEM_EVENT_VERSION ||
    content.type !== "employment.sent-home" ||
    typeof content.eventKey !== "string" ||
    typeof content.officeDay !== "string" ||
    !isOfficeDay(content.officeDay) ||
    expectedChannelId !== `all-hands:${content.officeDay}` ||
    !isEmploymentIdentifier(content.operatorId) ||
    !isEmploymentIdentifier(content.targetNewHireId) ||
    !expiry ||
    !Number.isFinite(expiry.getTime()) ||
    expiry.toISOString() !== content.expiresAt ||
    typeof content.text !== "string" ||
    content.text !==
      "An Operator sent a New Hire home for the rest of this Office Day." ||
    !content.eventKey.startsWith(`employment-event:v1:${content.officeDay}:`)
  ) {
    return null;
  }
  const event = content as PublicSendHomeSystemEvent;
  return {
    id: value.id,
    channelId: expectedChannelId,
    senderId: OFFICE_EVENT_SENDERS.operations,
    timestamp: value.timestamp,
    eventKey: event.eventKey,
    operatorId: event.operatorId,
    targetNewHireId: event.targetNewHireId,
    content: event,
    status: "sent",
  };
}
