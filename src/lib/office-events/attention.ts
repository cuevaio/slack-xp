export type OfficeEventInboxEntry = {
  muted: boolean;
  unread: number;
  mute(): void;
  markAsRead(): void;
};

export function silenceOfficeEventAttention(
  entry: OfficeEventInboxEntry | undefined,
): void {
  if (!entry) return;
  if (!entry.muted) entry.mute();
  if (entry.unread > 0) entry.markAsRead();
}
