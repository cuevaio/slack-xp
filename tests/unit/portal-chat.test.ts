import { describe, expect, test } from "bun:test";
import {
  listOfficeChannels,
  listOfficeChannelsForDay,
  officeChannelId,
  officeDayChannelIdsForAccessControl,
} from "@/lib/portal/channels";
import {
  createChatContentWithMentions,
  generalChannelId,
  linkifyChatText,
  parseChatContent,
  parsePortalChatMessage,
  SETUP_VERIFIER_USER_ID,
  validateChatDraft,
} from "@/lib/portal/chat";
import { createPortalTokenSource } from "@/lib/portal/client";
import {
  CACHED_MESSAGE_LIMIT,
  channelMessageQueryKey,
  readCachedChannelMessages,
  writeCachedChannelMessages,
} from "@/lib/portal/message-cache";

function createMemoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("Office Channel chat contract", () => {
  test("defines the complete curated directory with channel-first UTC Office Day ids", () => {
    const beforeMidnight = new Date("2026-07-22T23:59:59.999Z");

    expect(
      listOfficeChannels(beforeMidnight).map(
        ({ slug, id, name, purpose, mode }) => ({
          slug,
          id,
          name,
          purpose,
          mode,
        }),
      ),
    ).toEqual([
      {
        slug: "general",
        id: "general:2026-07-22",
        name: "General",
        purpose: "Company-wide conversation",
        mode: "standard",
      },
      {
        slug: "watercooler",
        id: "watercooler:2026-07-22",
        name: "Watercooler",
        purpose: "Casual conversation and breakroom chatter",
        mode: "standard",
      },
      {
        slug: "tech-support",
        id: "tech-support:2026-07-22",
        name: "Technical Support",
        purpose: "Comedic technical support for suspicious office technology",
        mode: "standard",
      },
      {
        slug: "urgent",
        id: "urgent:2026-07-22",
        name: "Urgent",
        purpose: "Urgent workplace chatter",
        mode: "standard",
      },
      {
        slug: "all-hands",
        id: "all-hands:2026-07-22",
        name: "All Hands",
        purpose: "System Events and company-wide announcements",
        mode: "broadcast",
      },
    ]);

    expect(generalChannelId(new Date("2026-07-22T23:59:59.999Z"))).toBe(
      "general:2026-07-22",
    );
    expect(generalChannelId(new Date("2026-07-23T00:00:00.000Z"))).toBe(
      "general:v2:2026-07-23",
    );
    expect(
      officeChannelId("all-hands", new Date("2026-07-23T00:00:00.000Z")),
    ).toBe("all-hands:v2:2026-07-23");
    expect(
      officeDayChannelIdsForAccessControl(
        ["general", "office-events"],
        "2026-07-23",
      ),
    ).toEqual([
      "general:v2:2026-07-23",
      "office-events:v2:2026-07-23",
      "general:2026-07-23",
      "office-events:2026-07-23",
    ]);
  });

  test("accepts only non-empty text payloads of at most 1,000 characters", () => {
    expect(parseChatContent({ text: "Hello, office" })).toEqual({
      text: "Hello, office",
    });
    expect(parseChatContent({ text: "A".repeat(1_000) })?.text).toHaveLength(
      1_000,
    );
    expect(parseChatContent({ text: "" })).toBeNull();
    expect(parseChatContent({ text: "   " })).toBeNull();
    expect(parseChatContent({ text: "A".repeat(1_001) })).toBeNull();
    expect(parseChatContent({ html: "<b>no</b>" })).toBeNull();
    expect(parseChatContent("hello")).toBeNull();

    expect(() => validateChatDraft("A".repeat(1_001))).toThrow(
      "1,000 characters",
    );
  });

  test("creates and validates structured mention ranges", () => {
    const content = createChatContentWithMentions(
      "Hello @Pat Pending and @Sam",
      [
        { userId: "user_pat", label: "@Pat Pending" },
        { userId: "user_sam", label: "@Sam" },
      ],
    );
    expect(content).toEqual({
      text: "Hello @Pat Pending and @Sam",
      mentionRanges: [
        { userId: "user_pat", start: 6, length: 12 },
        { userId: "user_sam", start: 23, length: 4 },
      ],
    });
    expect(parseChatContent(content)).toEqual(content);
    expect(
      parseChatContent({
        text: "Hello Pat",
        mentionRanges: [{ userId: "user_pat", start: 6, length: 3 }],
      }),
    ).toBeNull();
  });

  test("ignores malformed, retracted, ephemeral, and unknown Portal envelopes", () => {
    const message = {
      id: "message-1",
      channelId: "general:2026-07-22",
      sender: { id: "user-1", anon: false },
      timestamp: 1_753_184_800_000,
      kind: "text",
      type: "message",
      ephemeral: false,
      retracted: false,
      status: "sent",
      content: { text: "Safe" },
    };

    expect(parsePortalChatMessage(message)?.content.text).toBe("Safe");
    expect(
      parsePortalChatMessage({
        ...message,
        content: { richHtml: "<b>no</b>" },
      }),
    ).toBeNull();
    expect(parsePortalChatMessage({ ...message, type: "unknown" })).toBeNull();
    expect(parsePortalChatMessage({ ...message, ephemeral: true })).toBeNull();
    expect(parsePortalChatMessage({ ...message, retracted: true })).toBeNull();
    expect(
      parsePortalChatMessage({
        ...message,
        sender: { id: SETUP_VERIFIER_USER_ID, anon: false },
        content: { text: "setup-verification:test-marker" },
      }),
    ).toBeNull();
    expect(
      parsePortalChatMessage({ ...message, timestamp: Number.MAX_VALUE }),
    ).toBeNull();
  });

  test("keeps a bounded validated local fallback for each Office Channel", () => {
    const storage = createMemoryStorage();
    const channelId = "general:2026-07-22";
    const messages = Array.from(
      { length: CACHED_MESSAGE_LIMIT + 5 },
      (_, index) => ({
        id: `message-${index}`,
        channelId,
        sender: { id: "user-1", anon: false },
        timestamp: 1_753_184_800_000 + index,
        kind: "text",
        type: "message",
        ephemeral: false,
        retracted: false,
        status: "sent",
        content: { text: `Message ${index}` },
      }),
    );

    writeCachedChannelMessages(storage, channelId, [
      { unsafe: true },
      { ...messages[0], channelId: "urgent:2026-07-22" },
      ...messages,
    ]);

    const cached = readCachedChannelMessages(storage, channelId) as Array<{
      id: string;
    }>;
    expect(cached).toHaveLength(CACHED_MESSAGE_LIMIT);
    expect(cached[0]?.id).toBe("message-5");
    expect(cached.at(-1)?.id).toBe(`message-${CACHED_MESSAGE_LIMIT + 4}`);
    expect(readCachedChannelMessages(storage, "urgent:2026-07-22")).toEqual([]);
  });

  test("isolates cached message snapshots by Office Channel", () => {
    expect(channelMessageQueryKey("general:2026-07-22")).toEqual([
      "portal-channel-messages",
      "general:2026-07-22",
    ]);
    expect(channelMessageQueryKey("general:2026-07-22")).not.toEqual(
      channelMessageQueryKey("urgent:2026-07-22"),
    );
  });

  test("linkifies only safe HTTP(S) destinations and leaves markup as text", () => {
    expect(
      linkifyChatText(
        "Docs: https://example.com/path?q=1. <b>hello</b> javascript:alert(1)",
      ),
    ).toEqual([
      { kind: "text", value: "Docs: " },
      { kind: "link", value: "https://example.com/path?q=1" },
      {
        kind: "text",
        value: ". <b>hello</b> javascript:alert(1)",
      },
    ]);
  });

  test("uses a fresh server-minted token whenever the SDK callback refreshes", async () => {
    let sequence = 0;
    const tokenSource = createPortalTokenSource({
      expectedOfficeDay: "2026-07-22",
      fetcher: async () => {
        sequence += 1;
        return Response.json({
          token: `token-${sequence}`,
          channelIds: listOfficeChannelsForDay("2026-07-22").map(
            ({ id }) => id,
          ),
          eventChannelId: "office-events:2026-07-22",
        });
      },
    });

    expect(await tokenSource()).toBe("token-1");
    expect(await tokenSource()).toBe("token-2");
  });

  test("shares one server request across concurrent SDK token resolutions", async () => {
    let fetches = 0;
    let releaseFetch: () => void = () => {};
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const tokenSource = createPortalTokenSource({
      expectedOfficeDay: "2026-07-22",
      fetcher: async () => {
        fetches += 1;
        await fetchGate;
        return Response.json({
          token: "shared-token",
          channelIds: listOfficeChannelsForDay("2026-07-22").map(
            ({ id }) => id,
          ),
          eventChannelId: "office-events:2026-07-22",
        });
      },
    });

    const resolutions = Promise.all(
      Array.from({ length: 13 }, () => tokenSource()),
    );
    await Promise.resolve();
    const concurrentFetches = fetches;
    releaseFetch();

    expect(await resolutions).toEqual(Array(13).fill("shared-token"));
    expect(concurrentFetches).toBe(1);
  });

  test("uses a fresh Clerk token for every server token request", async () => {
    const authorizationHeaders: (string | null)[] = [];
    let sequence = 0;
    const tokenSource = createPortalTokenSource({
      expectedOfficeDay: "2026-07-22",
      getAuthorizationToken: async () => {
        sequence += 1;
        return `clerk-token-${sequence}`;
      },
      fetcher: async (_input, init) => {
        authorizationHeaders.push(
          new Headers(init?.headers).get("Authorization"),
        );
        return Response.json({
          token: `portal-token-${sequence}`,
          channelIds: listOfficeChannelsForDay("2026-07-22").map(
            ({ id }) => id,
          ),
          eventChannelId: "office-events:2026-07-22",
        });
      },
    });

    expect(await tokenSource()).toBe("portal-token-1");
    expect(await tokenSource()).toBe("portal-token-2");
    expect(authorizationHeaders).toEqual([
      "Bearer clerk-token-1",
      "Bearer clerk-token-2",
    ]);
  });

  test("rejects a reconnect token for a different Office Day", async () => {
    let expired = false;
    const tokenSource = createPortalTokenSource({
      expectedOfficeDay: "2026-07-22",
      fetcher: async () =>
        Response.json({
          token: "next-day-token",
          channelIds: listOfficeChannelsForDay("2026-07-23").map(
            ({ id }) => id,
          ),
          eventChannelId: "office-events:v2:2026-07-23",
        }),
      onOfficeDayExpired: () => {
        expired = true;
      },
    });

    await expect(tokenSource()).rejects.toThrow("Office Day has ended");
    expect(expired).toBe(true);
  });
});
