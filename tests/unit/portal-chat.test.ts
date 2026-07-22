import { describe, expect, test } from "bun:test";
import {
  listOfficeChannels,
  listOfficeChannelsForDay,
  officeChannelId,
} from "@/lib/portal/channels";
import {
  generalChannelId,
  linkifyChatText,
  parseChatContent,
  parsePortalChatMessage,
  validateChatDraft,
} from "@/lib/portal/chat";
import { createPortalTokenSource } from "@/lib/portal/client";

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
      "general:2026-07-23",
    );
    expect(
      officeChannelId("all-hands", new Date("2026-07-23T00:00:00.000Z")),
    ).toBe("all-hands:2026-07-23");
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
      parsePortalChatMessage({ ...message, timestamp: Number.MAX_VALUE }),
    ).toBeNull();
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
          eventChannelId: "office-events:2026-07-23",
        }),
      onOfficeDayExpired: () => {
        expired = true;
      },
    });

    await expect(tokenSource()).rejects.toThrow("Office Day has ended");
    expect(expired).toBe(true);
  });
});
