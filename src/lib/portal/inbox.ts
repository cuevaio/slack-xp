import {
  HR_REPORT_NOTIFICATION_TYPE,
  MESSAGE_HR_REPORT_NOTIFICATION_TITLE,
  PROFILE_HR_REPORT_NOTIFICATION_TITLE,
} from "@/lib/hr-reports/contract";
import { parseHRReportReviewTarget } from "@/lib/hr-reports/domain";
import { officeCharacterById } from "@/lib/office-days/contract";
import type { OfficeChannel } from "@/lib/portal/channels";
import { parseChatContent } from "@/lib/portal/chat";

export type OfficeInboxEntry = {
  id: string;
  unread: number;
  latest?: {
    text: string;
    sender: { id: string };
    at: number;
  };
};

export type OfficeInboxRow = {
  channelId: string;
  unread: number;
  preview: OfficeInboxPreview | null;
};

type HRReportInboxItemBase = {
  id: string;
  title: string;
  href: string;
  at: number;
  read: boolean;
};

export type HRReportInboxItem = HRReportInboxItemBase &
  (
    | {
        subjectType: "message";
        officeDay: string;
        officeChannelId: string;
        messageId: string;
      }
    | {
        subjectType: "profile";
        profileId: string;
      }
  );

export type OfficeInboxSnapshot = {
  entries: OfficeInboxEntry[];
  reportNotifications: HRReportInboxItem[];
};

type OfficeInboxPreview = {
  sender: string;
  text: string;
  at: number;
};

const MESSAGE_HR_REPORT_DATA_KEYS: ReadonlySet<string> = new Set([
  "title",
  "href",
  "subjectType",
  "officeDay",
  "officeChannelId",
  "messageId",
]);
const PROFILE_HR_REPORT_DATA_KEYS: ReadonlySet<string> = new Set([
  "title",
  "href",
  "subjectType",
  "profileId",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function parseHRReportInboxItem(
  value: unknown,
): HRReportInboxItem | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    value.type !== HR_REPORT_NOTIFICATION_TYPE ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    typeof value.read !== "boolean" ||
    !isObject(value.data)
  ) {
    return null;
  }
  const data = value.data;
  if (data.subjectType !== "message" && data.subjectType !== "profile") {
    return null;
  }
  const allowedKeys =
    data.subjectType === "profile"
      ? PROFILE_HR_REPORT_DATA_KEYS
      : MESSAGE_HR_REPORT_DATA_KEYS;
  if (Object.keys(data).some((key) => !allowedKeys.has(key))) return null;
  const title = typeof value.title === "string" ? value.title : data.title;
  if (typeof title !== "string" || typeof data.href !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(data.href);
  } catch {
    return null;
  }
  if (url.pathname !== "/office" || url.hash || url.username || url.password) {
    return null;
  }
  const target = parseHRReportReviewTarget(url.search);
  if (!target || target.subjectType !== data.subjectType) {
    return null;
  }
  const shared = {
    id: value.id,
    title,
    href: `${url.pathname}${url.search}`,
    at: value.at,
    read: value.read,
  };
  if (target.subjectType === "profile") {
    if (
      title !== PROFILE_HR_REPORT_NOTIFICATION_TITLE ||
      typeof data.profileId !== "string" ||
      target.profileId !== data.profileId
    ) {
      return null;
    }
    return {
      ...shared,
      subjectType: "profile",
      profileId: target.profileId,
    };
  }
  if (
    title !== MESSAGE_HR_REPORT_NOTIFICATION_TITLE ||
    typeof data.officeDay !== "string" ||
    typeof data.officeChannelId !== "string" ||
    typeof data.messageId !== "string" ||
    target.officeDay !== data.officeDay ||
    target.officeChannelId !== data.officeChannelId ||
    target.messageId !== data.messageId
  ) {
    return null;
  }
  return {
    ...shared,
    subjectType: "message",
    officeDay: target.officeDay,
    officeChannelId: target.officeChannelId,
    messageId: target.messageId,
  };
}

function parseHRReportInboxItems(value: unknown): HRReportInboxItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const notifications: HRReportInboxItem[] = [];
  for (const candidate of value) {
    const notification = parseHRReportInboxItem(candidate);
    if (!notification) {
      return null;
    }
    notifications.push(notification);
  }
  return notifications;
}

function parseOfficeInboxEntry(value: unknown): OfficeInboxEntry | null {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.unread !== "number" ||
    !Number.isFinite(value.unread)
  ) {
    return null;
  }

  if (value.latest === undefined) {
    return { id: value.id, unread: value.unread };
  }

  const latest = value.latest;
  if (
    !isObject(latest) ||
    typeof latest.text !== "string" ||
    !isObject(latest.sender) ||
    typeof latest.sender.id !== "string" ||
    typeof latest.at !== "number" ||
    !Number.isFinite(latest.at)
  ) {
    return null;
  }

  return {
    id: value.id,
    unread: value.unread,
    latest: {
      text: latest.text,
      sender: { id: latest.sender.id },
      at: latest.at,
    },
  };
}

export function parseOfficeInboxResponse(
  value: unknown,
): OfficeInboxEntry[] | null {
  if (!isObject(value) || !Array.isArray(value.channels)) {
    return null;
  }

  const entries: OfficeInboxEntry[] = [];
  for (const candidate of value.channels) {
    const entry = parseOfficeInboxEntry(candidate);
    if (!entry) {
      return null;
    }
    entries.push(entry);
  }
  return entries;
}

export function parseOfficeInboxSnapshot(
  value: unknown,
): OfficeInboxSnapshot | null {
  if (!isObject(value) || !("notifications" in value)) {
    return null;
  }

  const entries = parseOfficeInboxResponse(value);
  const reportNotifications = parseHRReportInboxItems(value.notifications);
  if (!entries || !reportNotifications) {
    return null;
  }

  return { entries, reportNotifications };
}

function createInboxPreview(
  entry: OfficeInboxEntry | undefined,
  identityId: string,
  displayName: string,
): OfficeInboxPreview | null {
  const latest = entry?.latest;
  if (!latest || !Number.isFinite(latest.at)) {
    return null;
  }

  const content = parseChatContent({ text: latest.text });
  if (!content) {
    return null;
  }

  return {
    sender: inboxSenderName(latest.sender.id, identityId, displayName),
    text: content.text,
    at: latest.at,
  };
}

function inboxSenderName(
  senderId: string,
  identityId: string,
  displayName: string,
): string {
  if (senderId === identityId) {
    return displayName;
  }

  const officeCharacter = officeCharacterById(senderId);
  if (officeCharacter) {
    return officeCharacter.name;
  }

  return "New Hire";
}

export function reconcileOfficeInbox({
  channels,
  entries,
  identityId,
  displayName,
}: {
  channels: readonly OfficeChannel[];
  entries: readonly OfficeInboxEntry[];
  identityId: string;
  displayName: string;
}): OfficeInboxRow[] {
  const entriesByChannelId = new Map(entries.map((entry) => [entry.id, entry]));

  return channels.map((channel) => {
    const entry = entriesByChannelId.get(channel.id);

    return {
      channelId: channel.id,
      unread: Math.max(0, Math.trunc(entry?.unread ?? 0)),
      preview: createInboxPreview(entry, identityId, displayName),
    };
  });
}
