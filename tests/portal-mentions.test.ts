import { describe, expect, mock, test } from "bun:test";
import type { InboxItem, Message } from "@portalsdk/core";
import {
  mentionHistoryAction,
  resolveMentionSources,
  viewedMentionIds,
} from "../src/lib/portal/mentions";

function mentionItem(
  id: string,
  seq: number,
  from: string,
  at = 1_000,
): InboxItem {
  return {
    id,
    type: "mention",
    data: { channelId: "general", seq, from },
    channelId: "general",
    at,
    read: false,
    markAsRead: () => undefined,
  };
}

function sourceMessage(
  id: string,
  seq: number,
  senderId: string,
  timestamp = 1_000,
) {
  return {
    id,
    seq,
    type: "message",
    content: { text: id },
    sender: { id: senderId, anon: false },
    timestamp,
    retracted: false as const,
  };
}

describe("Portal mention resolution", () => {
  test("only the resolved source message ID is considered viewed", () => {
    const first = mentionItem("mention_1", 10, "user_2");
    const second = mentionItem("mention_2", 11, "user_2");
    const sources = new Map([
      [first.id, sourceMessage("message_1", 10, "user_2")],
      [second.id, sourceMessage("message_2", 11, "user_2")],
    ]);
    const viewed = [
      {
        id: "message_2",
        sender: { id: "user_2", anon: false },
        timestamp: 1_000,
      } as Message<unknown>,
    ];

    expect(
      viewedMentionIds([first, second], sources, "general", viewed, true),
    ).toEqual(["mention_2"]);
    expect(
      viewedMentionIds([first, second], sources, "general", viewed, false),
    ).toEqual([]);
  });

  test("rejects mismatched sequence, sender, and retracted history records", async () => {
    const items = [
      mentionItem("wrong_seq", 10, "user_1"),
      mentionItem("wrong_sender", 11, "user_2"),
      mentionItem("retracted", 12, "user_3"),
    ];
    const fetcher = mock(async (input: RequestInfo | URL) => {
      const seq = Number(new URL(String(input)).searchParams.get("from"));
      const message = sourceMessage(`message_${seq}`, seq, `user_${seq - 9}`);
      if (seq === 10) message.seq = 99;
      if (seq === 11) message.sender.id = "someone_else";
      return Response.json({
        msgs: [seq === 12 ? { ...message, retracted: true } : message],
        hasMore: false,
      });
    });

    const sources = await resolveMentionSources(items, async () => "token", {
      fetcher,
    });

    expect([...sources.values()]).toEqual([null, null, null]);
  });

  test("turns invalid coordinates and request failures into unavailable sources", async () => {
    const items = [
      {
        ...mentionItem("fractional", 10, "user_1"),
        data: { seq: 10.5, from: "user_1" },
      },
      mentionItem("missing", 11, "user_2"),
      mentionItem("malformed", 12, "user_3"),
      mentionItem("non_2xx", 13, "user_4"),
    ];
    const fetcher = mock(async (input: RequestInfo | URL) => {
      const seq = Number(new URL(String(input)).searchParams.get("from"));
      if (seq === 11) return Response.json({ msgs: [] });
      if (seq === 12) return new Response("{", { status: 200 });
      return new Response("no", { status: 503 });
    });

    const sources = await resolveMentionSources(items, async () => "token", {
      fetcher,
    });

    expect([...sources.values()]).toEqual([null, null, null, null]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("turns token rejection into unavailable sources", async () => {
    const item = mentionItem("mention_1", 10, "user_1");
    const sources = await resolveMentionSources([item], async () => {
      throw new Error("token unavailable");
    });
    expect(sources.get(item.id)).toBeNull();
  });

  test("an aborted request does not return stale source results", async () => {
    const controller = new AbortController();
    const fetcher = mock(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = resolveMentionSources(
      [mentionItem("mention_1", 10, "user_1")],
      async () => "token",
      { fetcher, signal: controller.signal },
    );

    controller.abort();
    await expect(pending).rejects.toThrow("Aborted");
  });

  test("exact-message paging loads until found and terminates when unavailable", () => {
    expect(
      mentionHistoryAction({
        active: true,
        targetMessageId: "message_1",
        loadedMessageIds: ["message_1"],
        ready: true,
        hasPrevious: true,
        isLoadingPrevious: false,
      }),
    ).toBe("focus");
    expect(
      mentionHistoryAction({
        active: true,
        targetMessageId: "message_1",
        loadedMessageIds: [],
        ready: true,
        hasPrevious: true,
        isLoadingPrevious: false,
      }),
    ).toBe("load");
    expect(
      mentionHistoryAction({
        active: true,
        targetMessageId: "message_1",
        loadedMessageIds: [],
        ready: true,
        hasPrevious: false,
        isLoadingPrevious: false,
      }),
    ).toBe("unavailable");
  });
});
