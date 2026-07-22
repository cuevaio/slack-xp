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
  preview: {
    sender: string;
    text: string;
    at: number;
  } | null;
};

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
    const content = entry?.latest
      ? parseChatContent({ text: entry.latest.text })
      : null;
    const preview =
      entry?.latest && content && Number.isFinite(entry.latest.at)
        ? {
            sender:
              entry.latest.sender.id === identityId ? displayName : "New Hire",
            text: content.text,
            at: entry.latest.at,
          }
        : null;

    return {
      channelId: channel.id,
      unread: Math.max(0, Math.trunc(entry?.unread ?? 0)),
      preview,
    };
  });
}
