import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Message } from "@portalsdk/core";
import config, { containsBlockedLanguage } from "../portal.config";
import {
  canReactToMessage,
  createMentionedContent,
  groupMentionItems,
  isSameMessageDay,
  isVisibleChatMessage,
  messageDayLabel,
  messageText,
  messageTimestamp,
  readChannel,
  scrollToLatestSentMessage,
  sendChatMessage,
  shouldGroupMessages,
  shouldMarkVisibleMessagesRead,
  typingStatus,
  updateMemberProfiles,
  updateOfficeProfiles,
} from "../src/components/portal-chat";
import {
  findEmojiTrigger,
  replaceEmojiShortcodes,
  searchEmojis,
} from "../src/lib/emoji";
import { listOfficeChannels } from "../src/lib/portal/channels";
import { createPortalTokenSource } from "../src/lib/portal/client";
import {
  createReactionToggle,
  projectReactions,
  REACTION_EVENT_TYPE,
} from "../src/lib/portal/reactions";
import { createPortalSession } from "../src/lib/portal/server";
import { config as clerkProxyConfig } from "../src/proxy";

function portalMessage(
  id: string,
  senderId: string,
  type: string,
  content: unknown,
  timestamp: number,
): Message<unknown> {
  return {
    id,
    sender: { id: senderId, anon: false },
    type,
    content,
    timestamp,
    retracted: false,
  } as Message<unknown>;
}

describe("Portal teaching baseline", () => {
  test("runs Clerk middleware on every auth() boundary", () => {
    expect(clerkProxyConfig.matcher).toEqual(["/", "/api/office/portal/token"]);
  });

  test("defines two standard Office Channels with the same Portal properties", () => {
    expect(listOfficeChannels().map(({ id, mode }) => [id, mode])).toEqual([
      ["general", "standard"],
      ["announcements-v2", "standard"],
    ]);
    expect(config.channels?.general).toEqual(
      config.channels?.["announcements-v2"],
    );
    expect(containsBlockedLanguage("f.u.c.k")).toBe(true);
  });

  test("groups mention notifications by Office Channel and keeps legacy items", () => {
    const markAsRead = () => undefined;
    const groups = groupMentionItems(
      [
        {
          id: "mention_1",
          type: "mention",
          data: {},
          channelId: "general",
          at: 10,
          read: false,
          markAsRead,
        },
        {
          id: "mention_2",
          type: "mention",
          data: {},
          channelId: "announcements",
          at: 20,
          read: true,
          markAsRead,
        },
      ],
      listOfficeChannels(),
    );

    expect(
      groups.map(({ channelId, name, available }) => [
        channelId,
        name,
        available,
      ]),
    ).toEqual([
      ["announcements", "Archived channel", false],
      ["general", "General", true],
    ]);
  });

  test("reads only visible text messages", () => {
    const message = {
      content: { text: "Hello" },
      retracted: false,
    } as Message<{ text: string }>;
    expect(messageText(message)).toBe("Hello");
    expect(messageText({ ...message, retracted: true })).toBeNull();
  });

  test("groups consecutive messages from one sender for five minutes", () => {
    const message = {
      sender: { id: "user_1" },
      timestamp: 1_000,
      content: { text: "First" },
      retracted: false,
    } as Message<{ text: string }>;
    expect(
      shouldGroupMessages(message, {
        ...message,
        id: "message_2",
        timestamp: 301_000,
      }),
    ).toBe(true);
    expect(
      shouldGroupMessages(message, {
        ...message,
        id: "message_3",
        timestamp: 301_001,
      }),
    ).toBe(false);
  });

  test("starts a new message group when the local calendar day changes", () => {
    const beforeMidnight = new Date(2026, 6, 23, 23, 59).getTime();
    const afterMidnight = new Date(2026, 6, 24, 0, 1).getTime();
    const message = {
      sender: { id: "user_1" },
      timestamp: beforeMidnight,
      content: { text: "First" },
      retracted: false,
    } as Message<{ text: string }>;

    expect(isSameMessageDay(beforeMidnight, afterMidnight)).toBe(false);
    expect(
      shouldGroupMessages(message, {
        ...message,
        id: "message_2",
        timestamp: afterMidnight,
      }),
    ).toBe(false);
    expect(messageDayLabel(afterMidnight)).toContain("2026");
  });

  test("renders migrated messages at their original timestamp", () => {
    const message = portalMessage(
      "message_1",
      "user_1",
      "message",
      {
        text: "Migrated",
        portalMigration: {
          sourceMessageId: "old_message_1",
          originalTimestamp: 123_456,
        },
      },
      999_999,
    ) as Message<{
      text: string;
      portalMigration: {
        sourceMessageId: string;
        originalTimestamp: number;
      };
    }>;

    expect(messageTimestamp(message)).toBe(123_456);
  });

  test("requests a fresh Clerk credential for each Portal token", async () => {
    const getAuthorizationToken = mock(async () => "clerk-token");
    const fetcher = mock(async () => Response.json({ token: "portal-token" }));
    const token = createPortalTokenSource({ fetcher, getAuthorizationToken });
    expect(await token()).toBe("portal-token");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/office/portal/token",
      expect.objectContaining({
        headers: { Authorization: "Bearer clerk-token" },
      }),
    );
  });

  test("trims and sends chat messages without inventing Portal state", async () => {
    const send = mock(async () => ({ id: "message_1" }));
    expect(await sendChatMessage(send, "  Hello  ")).toBe(true);
    expect(send).toHaveBeenCalledWith({ content: { text: "Hello" } });
    expect(await sendChatMessage(send, "   ")).toBe(false);
  });

  test("scrolls to a sent message once it is rendered as the latest message", () => {
    const scrollRegion = { scrollHeight: 800, scrollTop: 120 };

    expect(
      scrollToLatestSentMessage({
        currentUserId: "user_1",
        latestSenderId: "user_2",
        pending: true,
        scrollRegion,
      }),
    ).toBe(false);
    expect(scrollRegion.scrollTop).toBe(120);

    expect(
      scrollToLatestSentMessage({
        currentUserId: "user_1",
        latestSenderId: "user_1",
        pending: true,
        scrollRegion,
      }),
    ).toBe(true);
    expect(scrollRegion.scrollTop).toBe(800);
  });

  test("sends selected New Hire mentions through Portal", async () => {
    const send = mock(async () => ({ id: "message_1" }));
    const mentions = [{ userId: "user_2", label: "@Grace" }];

    expect(createMentionedContent("  Hello @Grace  ", mentions)).toEqual({
      text: "Hello @Grace",
      mentionRanges: [{ userId: "user_2", start: 6, length: 6 }],
    });
    await sendChatMessage(send, "  Hello @Grace  ", mentions);

    expect(send).toHaveBeenCalledWith({
      content: {
        text: "Hello @Grace",
        mentionRanges: [{ userId: "user_2", start: 6, length: 6 }],
      },
      mentions: [{ userId: "user_2" }],
    });
  });

  test("finds and replaces Slack-style emoji shortcodes", () => {
    expect(findEmojiTrigger("Hello :smi", 10)).toEqual({
      start: 6,
      end: 10,
      query: "smi",
    });
    expect(findEmojiTrigger("https://portal.test", 19)).toBeNull();
    expect(searchEmojis("smile")[0]).toMatchObject({
      shortcode: "smile",
      unicode: "😄",
    });
    expect(replaceEmojiShortcodes("Hi :smile: :not_real:")).toEqual({
      text: "Hi 😄 :not_real:",
      cursor: 16,
    });
  });

  test("visible messages advance both channel and inbox positions", () => {
    const markChannelRead = mock(() => undefined);
    const markInboxRead = mock(() => undefined);
    readChannel(markChannelRead, { markAsRead: markInboxRead });
    expect(markChannelRead).toHaveBeenCalledTimes(1);
    expect(markInboxRead).toHaveBeenCalledTimes(1);
  });

  test("independent Portal snapshot timing does not block a visible read", () => {
    expect(
      shouldMarkVisibleMessagesRead({
        active: true,
        channelUnread: 15,
        documentVisible: true,
        hasVisibleMessage: true,
        inboxAvailable: true,
        inboxUnread: 14,
      }),
    ).toBe(true);
  });

  test("a visible channel repairs a stale inbox unread badge", () => {
    expect(
      shouldMarkVisibleMessagesRead({
        active: true,
        channelUnread: 0,
        documentVisible: true,
        hasVisibleMessage: true,
        inboxAvailable: true,
        inboxUnread: 11,
      }),
    ).toBe(true);
  });

  test("names the New Hires who are typing", () => {
    const profiles = new Map([
      ["user_1", { name: "Ada" }],
      ["user_2", { name: "Grace" }],
    ]);
    expect(typingStatus([], profiles, "viewer")).toBeNull();
    expect(typingStatus(["user_1"], profiles, "viewer")).toBe(
      "Ada is typing...",
    );
    expect(typingStatus(["user_1", "user_2"], profiles, "viewer")).toBe(
      "Ada and Grace are typing...",
    );
  });

  test("does not show the current New Hire as typing", () => {
    const profiles = new Map([
      ["user_1", { name: "Ada" }],
      ["user_2", { name: "Grace" }],
    ]);

    expect(typingStatus(["user_1"], profiles, "user_1")).toBeNull();
    expect(typingStatus(["user_1", "user_2"], profiles, "user_1")).toBe(
      "Grace is typing...",
    );
  });

  test("keeps detailed profiles when an aggregate presence update arrives", () => {
    const currentUser = {
      id: "user_1",
      name: "Ada",
      imageUrl: "https://images.example/ada.png",
    };
    const detailedRoster = updateOfficeProfiles(new Map(), currentUser, {
      kind: "detailed",
      count: 1,
      participants: [
        {
          id: "user_2",
          anon: false,
          username: "Grace",
          metadata: { avatar: "https://images.example/grace.png" },
        },
      ],
    });
    const broadcastRoster = updateOfficeProfiles(detailedRoster, currentUser, {
      kind: "aggregate",
      count: 1,
      recent: [],
    });

    expect([...broadcastRoster.values()]).toEqual([
      currentUser,
      {
        id: "user_2",
        name: "Grace",
        imageUrl: "https://images.example/grace.png",
      },
    ]);
  });

  test("keeps offline New Hire profiles when presence changes", () => {
    const currentUser = {
      id: "user_1",
      name: "Ada",
      imageUrl: "https://images.example/ada.png",
    };
    const profiles = new Map([
      [currentUser.id, currentUser],
      [
        "user_2",
        {
          id: "user_2",
          name: "Grace",
          imageUrl: "https://images.example/grace.png",
        },
      ],
    ]);

    expect([
      ...updateOfficeProfiles(profiles, currentUser, {
        kind: "detailed",
        count: 1,
        participants: [],
      }).values(),
    ]).toEqual([...profiles.values()]);
  });

  test("resolves offline New Hire profiles from the member directory", () => {
    expect(
      updateMemberProfiles(new Map(), [
        {
          userId: "user_2",
          online: false,
          claims: {
            username: "Grace",
            avatar: "https://images.example/grace.png",
          },
        },
      ]).get("user_2"),
    ).toEqual({
      id: "user_2",
      name: "Grace",
      imageUrl: "https://images.example/grace.png",
    });
  });

  test("projects persistent reaction toggles for live and late clients", () => {
    const chat = portalMessage(
      "message_1",
      "user_a",
      "message",
      { text: "Hello" },
      1,
    );
    const events = [
      portalMessage(
        "reaction_1",
        "user_a",
        REACTION_EVENT_TYPE,
        createReactionToggle("message_1", "like", "mutation_1").content,
        2,
      ),
      portalMessage(
        "reaction_2",
        "user_b",
        REACTION_EVENT_TYPE,
        createReactionToggle("message_1", "like", "mutation_2").content,
        3,
      ),
      portalMessage(
        "reaction_3",
        "user_a",
        REACTION_EVENT_TYPE,
        createReactionToggle("message_1", "like", "mutation_3").content,
        4,
      ),
    ];

    expect(projectReactions([chat, events[0]])).toEqual({
      message_1: { like: ["user_a"] },
    });
    expect(projectReactions([chat, ...events.slice(0, 2)])).toEqual({
      message_1: { like: ["user_a", "user_b"] },
    });
    expect(projectReactions([chat, ...events])).toEqual({
      message_1: { like: ["user_b"] },
    });
  });

  test("ignores malformed, duplicated, and retracted reaction records", () => {
    const valid = portalMessage(
      "reaction_1",
      "user_a",
      REACTION_EVENT_TYPE,
      createReactionToggle("message_1", "love", "mutation_1").content,
      1,
    );
    const duplicate = { ...valid, id: "reaction_2" };
    const malformed = portalMessage(
      "reaction_3",
      "user_b",
      REACTION_EVENT_TYPE,
      { targetMessageId: "message_1", reaction: "invalid" },
      2,
    );
    const retracted = { ...valid, id: "reaction_4", retracted: true };

    expect(projectReactions([valid, duplicate, malformed, retracted])).toEqual({
      message_1: { love: ["user_a"] },
    });
  });

  test("never renders reaction records as chat", () => {
    const reactionWithText = portalMessage(
      "reaction_1",
      "user_a",
      REACTION_EVENT_TYPE,
      {
        ...createReactionToggle("message_1", "like", "mutation_1").content,
        text: "Not conversation text",
      },
      1,
    );

    expect(messageText(reactionWithText)).toBe("Not conversation text");
    expect(isVisibleChatMessage(reactionWithText)).toBe(false);
  });

  test("waits for a stable Portal message ID before enabling reactions", () => {
    expect(canReactToMessage({ status: "pending" })).toBe(false);
    expect(canReactToMessage({ status: "sent" })).toBe(true);
  });

  test("hidden reaction records do not break visible chat grouping", () => {
    const first = portalMessage(
      "message_1",
      "user_a",
      "message",
      { text: "First" },
      1_000,
    ) as Message<{ text: string }>;
    const reaction = portalMessage(
      "reaction_1",
      "user_b",
      REACTION_EVENT_TYPE,
      createReactionToggle("message_1", "like", "mutation_1").content,
      2_000,
    );
    const second = portalMessage(
      "message_2",
      "user_a",
      "message",
      { text: "Second" },
      3_000,
    ) as Message<{ text: string }>;
    const visible = [first, reaction, second].filter(
      (message): message is Message<{ text: string }> =>
        messageText(message as Message<{ text: string }>) !== null,
    );

    expect(visible.map((message) => message.id)).toEqual([
      "message_1",
      "message_2",
    ]);
    expect(shouldGroupMessages(visible[0], visible[1])).toBe(true);
  });
});

describe("Portal session", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("ensures both memberships before minting the scoped token", async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = mock(async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return Response.json(
        String(input).endsWith("/v1/tokens") ? { token: "token" } : {},
      );
    }) as unknown as typeof fetch;
    await expect(
      createPortalSession("sk_secret", {
        id: "user_1",
        name: "Ada",
        imageUrl: null,
      }),
    ).resolves.toEqual({
      token: "token",
      channelIds: ["general", "announcements-v2"],
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.useportal.co/v1/channels/general/members",
      "https://api.useportal.co/v1/channels/announcements-v2/members",
      "https://api.useportal.co/v1/tokens",
    ]);
    expect(requests.at(-1)?.body).toEqual(
      expect.objectContaining({
        userId: "user_1",
        channels: {
          general: ["connect", "publish"],
          "announcements-v2": ["connect", "publish"],
        },
      }),
    );
  });
});
