import { describe, expect, test } from "bun:test";
import {
  OFFICE_CHARACTERS,
  parseScriptedSystemEventMessage,
  planOfficeDay,
} from "@/lib/office-days/contract";
import { SETUP_VERIFIER_USER_ID } from "@/lib/portal/chat";
import { parseOfficeChannelMessages } from "@/lib/portal/visible-messages";

describe("scripted Office Days", () => {
  test("plans one deterministic fixed-script System Event per Office Channel", () => {
    const first = planOfficeDay("2026-07-22");
    const replay = planOfficeDay("2026-07-22");

    expect(replay).toEqual(first);
    expect(first).toHaveLength(5);
    expect(new Set(first.map(({ eventKey }) => eventKey)).size).toBe(5);
    expect(first.map(({ channelId }) => channelId)).toEqual([
      "general:v3:2026-07-22",
      "watercooler:v3:2026-07-22",
      "tech-support:v3:2026-07-22",
      "urgent:v3:2026-07-22",
      "all-hands:v3:2026-07-22",
    ]);
    expect(
      first.every(({ eventKey }) =>
        eventKey.startsWith("system-event:v1:2026-07-22:"),
      ),
    ).toBe(true);
    expect(
      first.every(({ characterId }) =>
        OFFICE_CHARACTERS.some(({ id }) => id === characterId),
      ),
    ).toBe(true);
  });

  test("uses stable script identities with the v3 channel namespace", () => {
    const planned = planOfficeDay("2026-07-24");

    expect(planned.map(({ channelId }) => channelId)).toEqual([
      "general:v3:2026-07-24",
      "watercooler:v3:2026-07-24",
      "tech-support:v3:2026-07-24",
      "urgent:v3:2026-07-24",
      "all-hands:v3:2026-07-24",
    ]);
    expect(
      planned.every(
        ({ eventKey, scriptId }) =>
          eventKey.startsWith("system-event:v1:2026-07-24:") &&
          !scriptId.startsWith("v3-"),
      ),
    ).toBe(true);
  });

  test("accepts only fixed scripts from their Office Character sender", () => {
    const [planned] = planOfficeDay("2026-07-22");
    if (!planned) throw new Error("Expected a planned System Event");
    const message = {
      id: "portal-system-message-1",
      channelId: planned.channelId,
      sender: { id: planned.characterId, anon: false },
      timestamp: planned.dueAt.getTime(),
      retracted: false,
      ephemeral: false,
      kind: "text",
      type: "system.event",
      status: "sent",
      content: planned.event,
    };

    expect(parseScriptedSystemEventMessage(message, planned.channelId)).toEqual(
      expect.objectContaining({
        eventKey: planned.eventKey,
        character: expect.objectContaining({ fictional: true }),
      }),
    );
    expect(
      parseScriptedSystemEventMessage(
        { ...message, type: "message" },
        planned.channelId,
      ),
    ).toBeNull();
    expect(
      parseScriptedSystemEventMessage(
        { ...message, sender: { id: "user_human", anon: false } },
        planned.channelId,
      ),
    ).toBeNull();
    expect(
      parseScriptedSystemEventMessage(
        {
          ...message,
          content: { ...planned.event, text: "A generated surprise." },
        },
        planned.channelId,
      ),
    ).toBeNull();
  });

  test("deduplicates repeated Portal deliveries by deterministic event key", () => {
    const [planned] = planOfficeDay("2026-07-22");
    if (!planned) throw new Error("Expected a planned System Event");
    const envelope = {
      id: "portal-system-message-1",
      channelId: planned.channelId,
      sender: { id: planned.characterId, anon: false },
      timestamp: planned.dueAt.getTime(),
      retracted: false,
      ephemeral: false,
      kind: "text",
      type: "system.event",
      status: "sent",
      content: planned.event,
    };
    const result = parseOfficeChannelMessages(
      [envelope, { ...envelope, id: "portal-system-message-2" }],
      planned.channelId,
    );

    expect(result.messages).toHaveLength(1);
    expect(result.invalidCount).toBe(0);
  });

  test("silently omits setup verification messages from Office Channel history", () => {
    const result = parseOfficeChannelMessages(
      [
        {
          id: "setup-message-1",
          channelId: "general:2026-07-22",
          sender: { id: SETUP_VERIFIER_USER_ID, anon: false },
          timestamp: 1_753_184_800_000,
          retracted: false,
          ephemeral: false,
          kind: "text",
          type: "message",
          status: "sent",
          content: { text: "setup-verification:test-marker" },
        },
      ],
      "general:2026-07-22",
    );

    expect(result).toEqual({ messages: [], invalidCount: 0 });
  });
});
