import {
  EMPLOYMENT_SYSTEM_EVENT_MESSAGE_TYPE,
  EMPLOYMENT_SYSTEM_EVENT_VERSION,
  type EmploymentAccessDecision,
  type PublicSendHomeSystemEvent,
  type SafePublicSendHomeSystemEventMessage,
  SEND_HOME_PRIVATE_REASON_MAX_LENGTH,
  SEND_HOME_SYSTEM_EVENT_TEXT,
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

function parsePublicSendHomeSystemEvent(
  value: unknown,
  expectedChannelId: string,
): PublicSendHomeSystemEvent | null {
  if (!isObject(value)) return null;

  const expiresAt =
    typeof value.expiresAt === "string" ? new Date(value.expiresAt) : null;
  if (
    Object.keys(value).length !== 8 ||
    value.version !== EMPLOYMENT_SYSTEM_EVENT_VERSION ||
    value.type !== "employment.sent-home" ||
    typeof value.eventKey !== "string" ||
    typeof value.officeDay !== "string" ||
    !isOfficeDay(value.officeDay) ||
    expectedChannelId !== `all-hands:${value.officeDay}` ||
    !isEmploymentIdentifier(value.operatorId) ||
    !isEmploymentIdentifier(value.targetNewHireId) ||
    !expiresAt ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.toISOString() !== value.expiresAt ||
    value.text !== SEND_HOME_SYSTEM_EVENT_TEXT ||
    !value.eventKey.startsWith(`employment-event:v1:${value.officeDay}:`)
  ) {
    return null;
  }

  return {
    version: EMPLOYMENT_SYSTEM_EVENT_VERSION,
    type: "employment.sent-home",
    eventKey: value.eventKey,
    officeDay: value.officeDay,
    operatorId: value.operatorId,
    targetNewHireId: value.targetNewHireId,
    expiresAt: value.expiresAt,
    text: SEND_HOME_SYSTEM_EVENT_TEXT,
  };
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
    value.status !== "sent"
  ) {
    return null;
  }

  const event = parsePublicSendHomeSystemEvent(
    value.content,
    expectedChannelId,
  );
  if (!event) return null;

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
