import { describe, expect, test } from "bun:test";
import type { InboxEntry } from "@portalsdk/core";
import { listOfficeChannels } from "@/lib/portal/channels";
import { SETUP_VERIFIER_USER_ID } from "@/lib/portal/chat";
import {
  parseHRReportInboxItem,
  parseOfficeInboxResponse,
  parseOfficeInboxSnapshot,
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
  test("accepts only safe body-free HR Report review notifications", () => {
    const item = {
      id: "notification-17",
      type: "hr-report.ready",
      title: "Message HR Report ready for review",
      data: {
        title: "Message HR Report ready for review",
        href: "https://office.example.com/office?officeDay=2026-07-22&channel=general&message=message-17",
        subjectType: "message",
        officeDay: "2026-07-22",
        officeChannelId: "general:v3:2026-07-22",
        messageId: "message-17",
      },
      at: 1_753_188_000_000,
      read: false,
    };
    expect(parseHRReportInboxItem(item)).toEqual({
      id: "notification-17",
      title: "Message HR Report ready for review",
      href: "/office?officeDay=2026-07-22&channel=general&message=message-17",
      subjectType: "message",
      officeDay: "2026-07-22",
      officeChannelId: "general:v3:2026-07-22",
      messageId: "message-17",
      at: 1_753_188_000_000,
      read: false,
    });
    expect(
      parseHRReportInboxItem({
        ...item,
        data: { ...item.data, href: "https://evil.example/steal" },
      }),
    ).toBeNull();
    expect(
      parseOfficeInboxSnapshot({ channels: [], notifications: [item] }),
    ).toEqual({
      entries: [],
      reportNotifications: [
        {
          id: "notification-17",
          title: "Message HR Report ready for review",
          href: "/office?officeDay=2026-07-22&channel=general&message=message-17",
          subjectType: "message",
          officeDay: "2026-07-22",
          officeChannelId: "general:v3:2026-07-22",
          messageId: "message-17",
          at: 1_753_188_000_000,
          read: false,
        },
      ],
    });

    const profileItem = {
      id: "profile-notification-18",
      type: "hr-report.ready",
      title: "New Hire Profile HR Report ready for review",
      data: {
        title: "New Hire Profile HR Report ready for review",
        href: "https://office.example.com/office?profile=user_profile_subject",
        subjectType: "profile",
        profileId: "user_profile_subject",
      },
      at: 1_753_188_000_100,
      read: false,
    };
    expect(parseHRReportInboxItem(profileItem)).toEqual({
      id: "profile-notification-18",
      title: "New Hire Profile HR Report ready for review",
      href: "/office?profile=user_profile_subject",
      subjectType: "profile",
      profileId: "user_profile_subject",
      at: 1_753_188_000_100,
      read: false,
    });
    expect(
      parseHRReportInboxItem({
        ...profileItem,
        data: { ...profileItem.data, displayName: "Leaked Name" },
      }),
    ).toBeNull();
  });

  test("validates the complete inbox response at runtime", () => {
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
      inboxEntry("urgent:v3:2026-07-22", 4, "Deploy <script>alert(1)</script>"),
      inboxEntry(
        "general:v3:2026-07-22",
        2,
        "My own update",
        "user_current",
        1_753_188_100_000,
      ),
      inboxEntry("watercooler:2026-07-21", 99, "Yesterday"),
      inboxEntry(
        "watercooler:v3:2026-07-22",
        3,
        "The decaf pot is evidence.",
        "office-character:dot-matrix",
      ),
      inboxEntry("tech-support:v3:2026-07-22", 1, " ".repeat(4)),
      inboxEntry("all-hands:v3:2026-07-22", 8, "x".repeat(1_001)),
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
    expect(rows.map(({ unread }) => unread)).toEqual([2, 3, 1, 4, 8]);
    expect(rows[0]?.preview).toEqual({
      sender: "Pat Pending",
      text: "My own update",
      at: 1_753_188_100_000,
    });
    expect(rows[2]?.preview).toBeNull();
    expect(rows[1]?.preview).toMatchObject({
      sender: "Dot Matrix",
      text: "The decaf pot is evidence.",
    });
    expect(rows[3]?.preview).toMatchObject({
      sender: "New Hire",
      text: "Deploy <script>alert(1)</script>",
    });
    expect(rows[4]?.preview).toBeNull();
  });

  test("does not show setup verification messages in channel previews", () => {
    const channels = listOfficeChannels(new Date("2026-07-22T12:00:00.000Z"));
    const rows = reconcileOfficeInbox({
      channels,
      entries: [
        inboxEntry(
          "general:2026-07-22",
          1,
          "setup-verification:test-marker",
          SETUP_VERIFIER_USER_ID,
        ),
      ],
      identityId: "user_current",
      displayName: "Pat Pending",
    });

    expect(rows[0]?.preview).toBeNull();
  });
});
