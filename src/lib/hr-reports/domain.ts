import type {
  HRReportCategory,
  HRReportStableContext,
  MessageHRReportInput,
} from "@/lib/hr-reports/types";
import {
  isOfficeChannelSlug,
  listOfficeChannelsForDay,
} from "@/lib/portal/channels";
import { isOfficeDay, officeDay } from "@/lib/portal/office-day";

export const HR_REPORT_CATEGORIES = [
  "harassment-or-bullying",
  "hate-or-discrimination",
  "threatening-behavior",
  "sexual-content",
] as const;

export const HR_REPORT_CATEGORY_LABELS: Record<HRReportCategory, string> = {
  "harassment-or-bullying": "Harassment or bullying",
  "hate-or-discrimination": "Hate or discrimination",
  "threatening-behavior": "Threatening behavior",
  "sexual-content": "Sexual content",
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function isHRReportCategory(value: unknown): value is HRReportCategory {
  return HR_REPORT_CATEGORIES.some((category) => category === value);
}

function stableContext(
  officeDayValue: unknown,
  officeChannelId: unknown,
  messageId: unknown,
): HRReportStableContext | null {
  if (
    typeof officeDayValue !== "string" ||
    !isOfficeDay(officeDayValue) ||
    typeof officeChannelId !== "string" ||
    !isIdentifier(messageId)
  ) {
    return null;
  }
  const channel = listOfficeChannelsForDay(officeDayValue).find(
    ({ id }) => id === officeChannelId,
  );
  return channel
    ? { officeDay: officeDayValue, officeChannelId, messageId }
    : null;
}

export function parseMessageHRReportRequest(
  value: unknown,
  now: Date = new Date(),
): MessageHRReportInput | null {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 3 ||
    !isHRReportCategory(value.category)
  ) {
    return null;
  }
  const currentOfficeDay = officeDay(now);
  const context = stableContext(
    currentOfficeDay,
    value.officeChannelId,
    value.messageId,
  );
  return context ? { category: value.category, ...context } : null;
}

export function createHRReportDeepLink(
  appOrigin: string,
  context: HRReportStableContext,
): string {
  const validated = stableContext(
    context.officeDay,
    context.officeChannelId,
    context.messageId,
  );
  if (!validated) {
    throw new TypeError("A valid HR Report message context is required.");
  }
  const channel = listOfficeChannelsForDay(validated.officeDay).find(
    ({ id }) => id === validated.officeChannelId,
  );
  if (!channel) {
    throw new TypeError("A valid HR Report Office Channel is required.");
  }
  const url = new URL("/office", appOrigin);
  url.searchParams.set("officeDay", validated.officeDay);
  url.searchParams.set("channel", channel.slug);
  url.searchParams.set("message", validated.messageId);
  return url.toString();
}

export function parseHRReportReviewTarget(
  search: string,
): HRReportStableContext | null {
  const searchParams = new URLSearchParams(search);
  const officeDayValue = searchParams.get("officeDay");
  const channelSlug = searchParams.get("channel");
  const messageId = searchParams.get("message");
  if (!officeDayValue || !channelSlug || !isOfficeChannelSlug(channelSlug)) {
    return null;
  }
  return stableContext(
    officeDayValue,
    `${channelSlug}:${officeDayValue}`,
    messageId,
  );
}
