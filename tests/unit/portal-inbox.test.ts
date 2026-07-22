import { describe, expect, test } from "bun:test";
import type { InboxEntry } from "@portalsdk/core";
import { listOfficeChannels } from "@/lib/portal/channels";
import {
  parseOfficeInboxResponse,
  reconcileOfficeInbox,
} from "@/lib/portal/inbox";

function inboxEntry(
  id: string,
  unread: number,
  text: string,
  senderId = "user_colleague",
  at = 1_753_188_000_000,
): InboxEntry {
  return {
    id,
    unread,
    muted: false,
    at,
    latest: { text, sender: { id: senderId }, at },
    markAsRead() {},
    mute() {},
    unmute() {},
  };
}

describe("Office Channel inbox projection", () => {
  test("validates the complete mock inbox response at runtime", () => {
    expect(
      parseOfficeInboxResponse({
        channels: [
          { id: "general:2026-07-22", unread: 0 },
          {
            id: "urgent:2026-07-22",
            unread: 2,
            latest: {
              text: "The printer has entered negotiations.",
              sender: { id: "user_colleague" },
              at: 1_753_188_000_000,
            },
          },
        ],
      }),
    ).toEqual([
      { id: "general:2026-07-22", unread: 0 },
      {
        id: "urgent:2026-07-22",
        unread: 2,
        latest: {
          text: "The printer has entered negotiations.",
          sender: { id: "user_colleague" },
          at: 1_753_188_000_000,
        },
      },
    ]);

    for (const invalidResponse of [
      null,
      { channels: null },
      { channels: [{ id: "general:2026-07-22", unread: Number.NaN }] },
      {
        channels: [{ id: "general:2026-07-22", unread: 1, latest: null }],
      },
      {
        channels: [
          {
            id: "general:2026-07-22",
            unread: 1,
            latest: { text: "Hello", sender: {}, at: 1_753_188_000_000 },
          },
        ],
      },
    ]) {
      expect(parseOfficeInboxResponse(invalidResponse)).toBeNull();
    }
  });

  test("keeps curated order while applying authoritative unread rows and safe previews", () => {
    const channels = listOfficeChannels(new Date("2026-07-22T12:00:00.000Z"));
    const entries = [
      inboxEntry("urgent:2026-07-22", 4, "Deploy <script>alert(1)</script>"),
      inboxEntry(
        "general:2026-07-22",
        2,
        "My own update",
        "user_current",
        1_753_188_100_000,
      ),
      inboxEntry("watercooler:2026-07-21", 99, "Yesterday"),
      inboxEntry("tech-support:2026-07-22", 1, " ".repeat(4)),
      inboxEntry("all-hands:2026-07-22", 8, "x".repeat(1_001)),
    ];

    const rows = reconcileOfficeInbox({
      channels,
      entries,
      identityId: "user_current",
      displayName: "Pat Pending",
    });

    expect(rows.map(({ channelId }) => channelId)).toEqual(
      channels.map(({ id }) => id),
    );
    expect(rows.map(({ unread }) => unread)).toEqual([2, 0, 1, 4, 8]);
    expect(rows[0]?.preview).toEqual({
      sender: "Pat Pending",
      text: "My own update",
      at: 1_753_188_100_000,
    });
    expect(rows[2]?.preview).toBeNull();
    expect(rows[3]?.preview).toMatchObject({
      sender: "New Hire",
      text: "Deploy <script>alert(1)</script>",
    });
    expect(rows[4]?.preview).toBeNull();
  });
});
