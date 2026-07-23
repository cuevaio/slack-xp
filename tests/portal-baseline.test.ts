import { afterEach, describe, expect, mock, test } from "bun:test";
import type { Message } from "@portalsdk/core";
import type { ExtensionContext } from "@portalsdk/extension-protocol";
import ReactionExtension from "../extensions/reactions";
import config, { containsBlockedLanguage } from "../portal.config";
import {
  messageText,
  readChannel,
  sendChatMessage,
} from "../src/components/portal-chat";
import { listOfficeChannels } from "../src/lib/portal/channels";
import { createPortalTokenSource } from "../src/lib/portal/client";
import { createPortalSession } from "../src/lib/portal/server";
import { config as clerkProxyConfig } from "../src/proxy";

describe("Portal teaching baseline", () => {
  test("runs Clerk middleware on every auth() boundary", () => {
    expect(clerkProxyConfig.matcher).toEqual(["/", "/api/office/portal/token"]);
  });

  test("defines one stable standard and one stable broadcast channel", () => {
    expect(listOfficeChannels().map(({ id, mode }) => [id, mode])).toEqual([
      ["general", "standard"],
      ["announcements", "broadcast"],
    ]);
    expect(config.channels).toBeDefined();
    expect(containsBlockedLanguage("f.u.c.k")).toBe(true);
  });

  test("reads only visible text messages", () => {
    const message = {
      content: { text: "Hello" },
      retracted: false,
    } as Message<{ text: string }>;
    expect(messageText(message)).toBe("Hello");
    expect(messageText({ ...message, retracted: true })).toBeNull();
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

  test("manual read advances both channel and inbox positions", () => {
    const markChannelRead = mock(() => undefined);
    const markInboxRead = mock(() => undefined);
    readChannel(markChannelRead, { markAsRead: markInboxRead });
    expect(markChannelRead).toHaveBeenCalledTimes(1);
    expect(markInboxRead).toHaveBeenCalledTimes(1);
  });
});

describe("reaction extension", () => {
  test("toggles durable per-user reactions and snapshots late-join state", async () => {
    const values = new Map<string, unknown>();
    const context = {
      storage: {
        get: async <T>(key: string) => values.get(key) as T | undefined,
        put: async (key: string, value: unknown) => {
          values.set(key, value);
        },
        delete: async (key: string) => values.delete(key),
        list: async () => new Map(),
      },
    } satisfies ExtensionContext;
    const extension = new ReactionExtension(context);
    await extension.onInit?.();
    const response = await extension.onBatch({
      kind: "batch",
      channelId: "general",
      epoch: 1,
      batchSeq: 1,
      messages: [
        {
          type: "reaction.toggle",
          content: { messageId: "message_1", reaction: "like" },
          senderId: "user_1",
          at: 1,
        },
      ],
    });
    expect(response).toEqual({
      broadcasts: [
        {
          type: "reaction.state",
          content: {
            messageId: "message_1",
            reactions: { like: ["user_1"] },
          },
        },
      ],
      snapshotDirty: true,
    });
    expect(extension.onSnapshot?.()).toEqual({
      snapshot: { reactions: { message_1: { like: ["user_1"] } } },
    });
    expect(
      await extension.onBatch({
        kind: "batch",
        channelId: "general",
        epoch: 1,
        batchSeq: 1,
        messages: [],
      }),
    ).toBeUndefined();
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
      channelIds: ["general", "announcements"],
    });
    expect(requests.map(({ url }) => url)).toEqual([
      "https://api.useportal.co/v1/channels/general/members",
      "https://api.useportal.co/v1/channels/announcements/members",
      "https://api.useportal.co/v1/tokens",
    ]);
    expect(requests.at(-1)?.body).toEqual(
      expect.objectContaining({
        userId: "user_1",
        channels: {
          general: ["connect", "publish"],
          announcements: ["connect", "publish"],
        },
      }),
    );
  });
});
