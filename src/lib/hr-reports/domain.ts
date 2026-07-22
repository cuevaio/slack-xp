import {
  HR_REPORT_CATEGORIES,
  type HRReportNotification,
  type HRReportNotificationContent,
  type HRReportStableContext,
  type MessageHRReportCategory,
  type MessageHRReportInput,
  PROFILE_HR_REPORT_CATEGORIES,
  type ProfileHRReportCategory,
  type ProfileHRReportInput,
} from "@/lib/hr-reports/contract";
import {
  isOfficeChannelSlug,
  listOfficeChannelsForDay,
} from "@/lib/portal/channels";
import { isOfficeDay, officeDay } from "@/lib/portal/office-day";

export {
  HR_REPORT_CATEGORIES,
  PROFILE_HR_REPORT_CATEGORIES,
} from "@/lib/hr-reports/contract";

export const HR_REPORT_CATEGORY_LABELS: Record<
  MessageHRReportCategory,
  string
> = {
  "harassment-or-bullying": "Harassment or bullying",
  "hate-or-discrimination": "Hate or discrimination",
  "threatening-behavior": "Threatening behavior",
  "sexual-content": "Sexual content",
};

export const PROFILE_HR_REPORT_CATEGORY_LABELS: Record<
  ProfileHRReportCategory,
  string
> = {
  "abusive-or-hateful-name": "Abusive or hateful name",
  "abusive-or-explicit-picture": "Abusive or explicit picture",
  impersonation: "Impersonation",
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isHRReportIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

export function parseHRReportDismissalRequest(
  value: unknown,
): { reportId: string; privateNote: string | null } | null {
  if (!isObject(value) || !isHRReportIdentifier(value.reportId)) return null;
  const keys = Object.keys(value);
  if (
    keys.length > 2 ||
    keys.some((key) => key !== "reportId" && key !== "privateNote")
  ) {
    return null;
  }
  if (value.privateNote === undefined || value.privateNote === null) {
    return { reportId: value.reportId, privateNote: null };
  }
  if (typeof value.privateNote !== "string") return null;
  const privateNote = value.privateNote.trim();
  if (privateNote.length === 0) {
    return { reportId: value.reportId, privateNote: null };
  }
  if (privateNote.length > 1_000) return null;
  return { reportId: value.reportId, privateNote };
}

export function isHRReportCategory(
  value: unknown,
): value is MessageHRReportCategory {
  return HR_REPORT_CATEGORIES.some((category) => category === value);
}

export function isProfileHRReportCategory(
  value: unknown,
): value is ProfileHRReportCategory {
  return PROFILE_HR_REPORT_CATEGORIES.some((category) => category === value);
}

function stableMessageContext(
  officeDayValue: unknown,
  officeChannelId: unknown,
  messageId: unknown,
): Extract<HRReportStableContext, { subjectType: "message" }> | null {
  if (
    typeof officeDayValue !== "string" ||
    !isOfficeDay(officeDayValue) ||
    typeof officeChannelId !== "string" ||
    !isHRReportIdentifier(messageId)
  ) {
    return null;
  }
  const channel = listOfficeChannelsForDay(officeDayValue).find(
    ({ id }) => id === officeChannelId,
  );
  if (!channel) return null;

  return {
    subjectType: "message",
    officeDay: officeDayValue,
    officeChannelId,
    messageId,
  };
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
  const context = stableMessageContext(
    currentOfficeDay,
    value.officeChannelId,
    value.messageId,
  );
  if (!context) return null;
  const { subjectType: _subjectType, ...stableContext } = context;
  return { category: value.category, ...stableContext };
}

export function parseProfileHRReportRequest(
  value: unknown,
): ProfileHRReportInput | null {
  if (
    !isObject(value) ||
    Object.keys(value).length !== 3 ||
    value.subjectType !== "profile" ||
    !isProfileHRReportCategory(value.category) ||
    !isHRReportIdentifier(value.profileId)
  ) {
    return null;
  }
  return {
    subjectType: "profile",
    category: value.category,
    profileId: value.profileId,
  };
}

export function toHRReportNotificationContent(
  notification: HRReportNotification,
): HRReportNotificationContent {
  if (notification.subjectType === "profile") {
    return {
      title: notification.title,
      href: notification.href,
      subjectType: "profile",
      profileId: notification.profileId,
    };
  }

  return {
    title: notification.title,
    href: notification.href,
    subjectType: "message",
    officeDay: notification.officeDay,
    officeChannelId: notification.officeChannelId,
    messageId: notification.messageId,
  };
}

type LegacyMessageContext = Omit<
  Extract<HRReportStableContext, { subjectType: "message" }>,
  "subjectType"
>;

export function createHRReportDeepLink(
  appOrigin: string,
  context: HRReportStableContext | LegacyMessageContext,
): string {
  if ("profileId" in context) {
    if (!isHRReportIdentifier(context.profileId)) {
      throw new TypeError("A valid HR Report New Hire Profile is required.");
    }
    const url = new URL("/office", appOrigin);
    url.searchParams.set("profile", context.profileId);
    return url.toString();
  }

  const validated = stableMessageContext(
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
  const profileId = searchParams.get("profile");
  if (profileId !== null) {
    if (searchParams.size !== 1 || !isHRReportIdentifier(profileId)) {
      return null;
    }
    return { subjectType: "profile", profileId };
  }

  const officeDayValue = searchParams.get("officeDay");
  const channelSlug = searchParams.get("channel");
  const messageId = searchParams.get("message");
  if (!officeDayValue || !channelSlug || !isOfficeChannelSlug(channelSlug)) {
    return null;
  }
  return stableMessageContext(
    officeDayValue,
    `${channelSlug}:${officeDayValue}`,
    messageId,
  );
}
