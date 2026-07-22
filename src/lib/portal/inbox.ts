import {
  HR_REPORT_NOTIFICATION_TITLE,
  HR_REPORT_NOTIFICATION_TYPE,
} from "@/lib/hr-reports/contract";
import { parseHRReportReviewTarget } from "@/lib/hr-reports/domain";
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

export type HRReportInboxItem = {
  id: string;
  title: string;
  href: string;
  officeDay: string;
  officeChannelId: string;
  messageId: string;
  at: number;
  read: boolean;
};

export type OfficeInboxSnapshot = {
  entries: OfficeInboxEntry[];
  reportNotifications: HRReportInboxItem[];
};

type OfficeInboxPreview = {
  sender: string;
  text: string;
  at: number;
};

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
  if (
    Object.keys(data).some(
      (key) =>
        ![
          "title",
          "href",
          "officeDay",
          "officeChannelId",
          "messageId",
        ].includes(key),
    )
  ) {
    return null;
  }
  const title = typeof value.title === "string" ? value.title : data.title;
  if (
    title !== HR_REPORT_NOTIFICATION_TITLE ||
    typeof data.href !== "string" ||
    typeof data.officeDay !== "string" ||
    typeof data.officeChannelId !== "string" ||
    typeof data.messageId !== "string"
  ) {
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
  if (
    !target ||
    target.officeDay !== data.officeDay ||
    target.officeChannelId !== data.officeChannelId ||
    target.messageId !== data.messageId
  ) {
    return null;
  }
  return {
    id: value.id,
    title,
    href: `${url.pathname}${url.search}`,
    officeDay: data.officeDay,
    officeChannelId: data.officeChannelId,
    messageId: data.messageId,
    at: value.at,
    read: value.read,
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
    sender: latest.sender.id === identityId ? displayName : "New Hire",
    text: content.text,
    at: latest.at,
  };
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
