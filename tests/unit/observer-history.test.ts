import { describe, expect, test } from "bun:test";
import {
  fetchObserverChannelHistory,
  projectObserverChannelHistory,
} from "@/lib/portal/observer";

describe("Observer history projection", () => {
  test("accepts only the narrow public response shape", async () => {
    const messages = await fetchObserverChannelHistory("general", async () =>
      Response.json({
        messages: [
          {
            groupedWithPrevious: false,
            id: "message-1",
            sender: "New Hire",
            timestamp: 1_753_184_800_000,
            text: "Hello",
          },
        ],
      }),
    );
    expect(messages).toHaveLength(1);

    await expect(
      fetchObserverChannelHistory("general", async () =>
        Response.json({ messages: [{ id: "message-1", token: "unsafe" }] }),
      ),
    ).rejects.toThrow("Observer history is unavailable.");
  });

  test("drops invalid and removed Portal envelopes", () => {
    const channelId = "general:2026-07-22";
    const raw = {
      id: "message-1",
      channelId,
      sender: { id: "user-1", anon: false },
      timestamp: 1_753_184_800_000,
      kind: "text",
      type: "message",
      ephemeral: false,
      retracted: false,
      status: "sent",
      content: { text: "Hello" },
    };
    expect(
      projectObserverChannelHistory(
        [raw, { ...raw, id: "message-2" }, { unsafe: true }],
        channelId,
        new Set(["message-2"]),
      ),
    ).toEqual([
      {
        groupedWithPrevious: false,
        id: "message-1",
        sender: "New Hire",
        timestamp: 1_753_184_800_000,
        text: "Hello",
      },
    ]);
  });

  test("groups consecutive messages from the same New Hire without exposing identity", () => {
    const channelId = "general:2026-07-22";
    const timestamp = 1_753_184_800_000;
    const message = {
      id: "message-1",
      channelId,
      sender: { id: "user-1", anon: false },
      timestamp,
      kind: "text",
      type: "message",
      ephemeral: false,
      retracted: false,
      status: "sent",
      content: { text: "Hello" },
    };

    expect(
      projectObserverChannelHistory(
        [
          message,
          { ...message, id: "message-2", timestamp: timestamp + 60_000 },
          {
            ...message,
            id: "message-3",
            sender: { id: "user-2", anon: false },
            timestamp: timestamp + 120_000,
          },
          { ...message, id: "message-4", timestamp: timestamp + 600_000 },
        ],
        channelId,
        new Set(),
      ).map(({ id, groupedWithPrevious }) => ({
        id,
        groupedWithPrevious,
      })),
    ).toEqual([
      { id: "message-1", groupedWithPrevious: false },
      { id: "message-2", groupedWithPrevious: true },
      { id: "message-3", groupedWithPrevious: false },
      { id: "message-4", groupedWithPrevious: false },
    ]);
  });
});
