import { describe, expect, test } from "bun:test";
import {
  generalChannelId,
  linkifyChatText,
  parseChatContent,
  parsePortalChatMessage,
  validateChatDraft,
} from "@/lib/portal/chat";
import { createPortalTokenSource } from "@/lib/portal/client";

describe("general Office Channel chat contract", () => {
  test("uses the UTC Office Day in the stable general channel id", () => {
    expect(generalChannelId(new Date("2026-07-22T23:59:59.999Z"))).toBe(
      "2026-07-22:general",
    );
    expect(generalChannelId(new Date("2026-07-23T00:00:00.000Z"))).toBe(
      "2026-07-23:general",
    );
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
      channelId: "2026-07-22:general",
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
    const tokenSource = createPortalTokenSource(async () => {
      sequence += 1;
      return Response.json({ token: `token-${sequence}` });
    });

    expect(await tokenSource()).toBe("token-1");
    expect(await tokenSource()).toBe("token-2");
  });
});
