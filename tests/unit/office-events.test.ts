import { describe, expect, test } from "bun:test";
import { silenceOfficeEventAttention } from "@/lib/office-events/attention";
import {
  createOfficeEventDispatcher,
  createOfficeEventKey,
  createReactionOfficeEvent,
  createReactionProjection,
  OFFICE_EVENT_MESSAGE_TYPE,
  OFFICE_EVENT_SENDERS,
  OFFICE_EVENT_VERSION,
  type OfficeEvent,
  officeEventChannelId,
  parseOfficeEvent,
  parseOfficeEventMessage,
} from "@/lib/office-events/contract";

const occurredAt = "2026-07-22T12:00:00.000Z";

function eventKey(type: OfficeEvent["type"], sourceId: string): string {
  return createOfficeEventKey(type, sourceId);
}

function envelope(
  event: unknown,
  senderId = "user_reactor",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: "portal-event-1",
    channelId: "office-events:2026-07-22",
    sender: { id: senderId, anon: false },
    timestamp: 1_753_188_000_000,
    kind: "text",
    type: OFFICE_EVENT_MESSAGE_TYPE,
    ephemeral: false,
    retracted: false,
    status: "sent",
    content: event,
    ...overrides,
  };
}

const supportedEvents: readonly OfficeEvent[] = [
  {
    version: OFFICE_EVENT_VERSION,
    type: "reaction.changed",
    eventKey: eventKey("reaction.changed", "reaction-operation-1"),
    occurredAt,
    officeDay: "2026-07-22",
    officeChannelId: "general:2026-07-22",
    messageId: "message-1",
    actorId: "user_reactor",
    reaction: "👍",
    operation: "add",
  },
  {
    version: OFFICE_EVENT_VERSION,
    type: "profile.invalidated",
    eventKey: eventKey("profile.invalidated", "profile-change-1"),
    occurredAt,
    profileId: "user_profile",
  },
  {
    version: OFFICE_EVENT_VERSION,
    type: "report.invalidated",
    eventKey: eventKey("report.invalidated", "report-change-1"),
    occurredAt,
    reportId: "report-1",
  },
  {
    version: OFFICE_EVENT_VERSION,
    type: "message-removal.invalidated",
    eventKey: eventKey("message-removal.invalidated", "message-removal-1"),
    occurredAt,
    messageId: "message-1",
  },
  {
    version: OFFICE_EVENT_VERSION,
    type: "employment.invalidated",
    eventKey: eventKey("employment.invalidated", "employment-change-1"),
    occurredAt,
    newHireId: "user_new_hire",
  },
  {
    version: OFFICE_EVENT_VERSION,
    type: "operator.invalidated",
    eventKey: eventKey("operator.invalidated", "operator-change-1"),
    occurredAt,
    operatorId: "user_operator",
  },
];

describe("versioned Office Event contract", () => {
  test("uses one hidden channel for each UTC Office Day", () => {
    expect(officeEventChannelId(new Date("2026-07-22T23:59:59.999Z"))).toBe(
      "office-events:2026-07-22",
    );
    expect(officeEventChannelId(new Date("2026-07-23T00:00:00.000Z"))).toBe(
      "office-events:2026-07-23",
    );
  });

  test("runtime-validates every supported v1 event", () => {
    for (const event of supportedEvents) {
      expect(parseOfficeEvent(event)).toEqual(event);
    }
  });

  test("creates stable, type-bound event keys", () => {
    expect(createOfficeEventKey("reaction.changed", "operation_123")).toBe(
      createOfficeEventKey("reaction.changed", "operation_123"),
    );
    expect(
      createOfficeEventKey("profile.invalidated", "operation_123"),
    ).not.toBe(createOfficeEventKey("reaction.changed", "operation_123"));
    expect(() =>
      createOfficeEventKey("reaction.changed", "contains spaces"),
    ).toThrow("source identifier");
  });

  test("creates a complete reaction event with a retry-stable identity", () => {
    const input = {
      mutationId: "reaction-operation-44",
      occurredAt,
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-44",
      actorId: "user_reactor",
      reaction: "🎉" as const,
      operation: "add" as const,
    };

    expect(createReactionOfficeEvent(input)).toEqual({
      version: OFFICE_EVENT_VERSION,
      type: "reaction.changed",
      eventKey: eventKey("reaction.changed", input.mutationId),
      occurredAt,
      officeDay: "2026-07-22",
      officeChannelId: "general:2026-07-22",
      messageId: "message-44",
      actorId: "user_reactor",
      reaction: "🎉",
      operation: "add",
    });
    expect(createReactionOfficeEvent(input)).toEqual(
      createReactionOfficeEvent(input),
    );
    expect(() =>
      createReactionOfficeEvent({
        ...input,
        officeChannelId: "watercooler:2026-07-21",
      }),
    ).toThrow("Office Day");
  });

  test("rejects unknown, malformed, oversized, and mutable invalidation payloads", () => {
    const reaction = supportedEvents[0];
    const invalidation = supportedEvents[1];
    expect(parseOfficeEvent({ ...reaction, version: 2 })).toBeNull();
    expect(
      parseOfficeEvent({ ...reaction, type: "reaction.created" }),
    ).toBeNull();
    expect(parseOfficeEvent({ ...reaction, messageId: " bad-id " })).toBeNull();
    expect(
      parseOfficeEvent({ ...reaction, occurredAt: "yesterday" }),
    ).toBeNull();
    expect(parseOfficeEvent({ ...reaction, eventKey: "retry-me" })).toBeNull();
    expect(parseOfficeEvent({ ...reaction, reaction: "custom" })).toBeNull();
    expect(
      parseOfficeEvent({ ...invalidation, displayName: "Mutable name" }),
    ).toBeNull();
    expect(
      parseOfficeEvent({ ...reaction, padding: "x".repeat(2_100) }),
    ).toBeNull();
  });

  test("accepts reactions from their actor and invalidations only from reserved senders", () => {
    const reaction = supportedEvents[0];

    expect(
      parseOfficeEventMessage(
        envelope(reaction),
        officeEventChannelId(new Date(occurredAt)),
      ),
    ).toMatchObject({ event: reaction, senderId: "user_reactor" });
    expect(
      parseOfficeEventMessage(
        envelope(reaction, "user_impersonator"),
        "office-events:2026-07-22",
      ),
    ).toBeNull();

    for (const invalidation of supportedEvents.slice(1)) {
      const trustedSender =
        invalidation.type === "profile.invalidated"
          ? OFFICE_EVENT_SENDERS.profiles
          : OFFICE_EVENT_SENDERS.operations;
      const wrongReservedSender =
        trustedSender === OFFICE_EVENT_SENDERS.profiles
          ? OFFICE_EVENT_SENDERS.operations
          : OFFICE_EVENT_SENDERS.profiles;
      expect(
        parseOfficeEventMessage(
          envelope(invalidation, trustedSender),
          "office-events:2026-07-22",
        ),
      ).toMatchObject({ event: invalidation });
      expect(
        parseOfficeEventMessage(
          envelope(invalidation),
          "office-events:2026-07-22",
        ),
      ).toBeNull();
      expect(
        parseOfficeEventMessage(
          envelope(invalidation, wrongReservedSender),
          "office-events:2026-07-22",
        ),
      ).toBeNull();
    }
  });

  test("rejects Office Events delivered as ordinary, ephemeral, retracted, or wrong-channel messages", () => {
    const reaction = supportedEvents[0];
    for (const changed of [
      { type: "message" },
      { ephemeral: true },
      { retracted: true },
      { channelId: "general:2026-07-22" },
      { sender: { id: "user_reactor", anon: true } },
    ]) {
      expect(
        parseOfficeEventMessage(
          envelope(reaction, "user_reactor", changed),
          "office-events:2026-07-22",
        ),
      ).toBeNull();
    }
    expect(
      parseOfficeEventMessage(
        envelope(reaction, "user_reactor", {
          channelId: "general:2026-07-22",
        }),
        "general:2026-07-22",
      ),
    ).toBeNull();
    expect(
      parseOfficeEventMessage(
        envelope({ ...reaction, officeChannelId: "general:2026-07-21" }),
        "office-events:2026-07-22",
      ),
    ).toBeNull();
  });

  test("deduplicates retry and reconnect replay while processing later events", () => {
    const reactions: OfficeEvent[] = [];
    const invalidations: OfficeEvent[] = [];
    const dispatcher = createOfficeEventDispatcher({
      channelId: "office-events:2026-07-22",
      onReaction: (event) => reactions.push(event),
      onInvalidation: (event) => invalidations.push(event),
    });
    const first = supportedEvents[0];
    const later = {
      ...first,
      eventKey: eventKey("reaction.changed", "reaction-operation-2"),
      occurredAt: "2026-07-22T12:01:00.000Z",
      operation: "remove" as const,
    };

    expect(dispatcher.dispatch(envelope({ version: 99 }))).toBe("ignored");
    expect(reactions).toEqual([]);
    expect(invalidations).toEqual([]);
    expect(dispatcher.dispatch(envelope(first))).toBe("reaction");
    expect(dispatcher.dispatch(envelope(first))).toBe("duplicate");
    expect(dispatcher.dispatch(envelope(first))).toBe("duplicate");
    expect(dispatcher.dispatch(envelope(later))).toBe("reaction");
    expect(
      dispatcher.dispatch(
        envelope(supportedEvents[1], OFFICE_EVENT_SENDERS.profiles),
      ),
    ).toBe("invalidation");
    expect(reactions).toEqual([first, later]);
    expect(invalidations).toEqual([supportedEvents[1]]);
  });

  test("folds authoritative reactions once while allowing a later operation", () => {
    const projection = createReactionProjection();
    const added = supportedEvents[0];
    if (added.type !== "reaction.changed") {
      throw new Error("Expected the reaction fixture first.");
    }
    const removed = {
      ...added,
      eventKey: eventKey("reaction.changed", "reaction-operation-2"),
      occurredAt: "2026-07-22T12:01:00.000Z",
      operation: "remove" as const,
    };

    expect(projection.apply(added)).toBe(true);
    expect(projection.apply(added)).toBe(false);
    expect(projection.read(added.officeChannelId, added.messageId)).toEqual([
      { reaction: "👍", actorIds: ["user_reactor"] },
    ]);
    expect(projection.apply(removed)).toBe(true);
    expect(projection.read(added.officeChannelId, added.messageId)).toEqual([]);
  });

  test("folds duplicate and out-of-order operations by event time", () => {
    const first = supportedEvents[0];
    if (first.type !== "reaction.changed") {
      throw new Error("Expected the reaction fixture first.");
    }
    const removed = {
      ...first,
      eventKey: eventKey("reaction.changed", "reaction-operation-2"),
      occurredAt: "2026-07-22T12:02:00.000Z",
      operation: "remove" as const,
    };
    const addedAgain = {
      ...first,
      eventKey: eventKey("reaction.changed", "reaction-operation-3"),
      occurredAt: "2026-07-22T12:03:00.000Z",
    };
    const projection = createReactionProjection();

    expect(projection.apply(removed)).toBe(true);
    expect(projection.apply(first)).toBe(false);
    expect(projection.apply(removed)).toBe(false);
    expect(projection.read(first.officeChannelId, first.messageId)).toEqual([]);
    expect(projection.apply(addedAgain)).toBe(true);
    expect(projection.read(first.officeChannelId, first.messageId)).toEqual([
      { reaction: "👍", actorIds: ["user_reactor"] },
    ]);
  });

  test("uses the event key to break equal-timestamp ties", () => {
    const first = supportedEvents[0];
    if (first.type !== "reaction.changed") {
      throw new Error("Expected the reaction fixture first.");
    }
    const laterKey = {
      ...first,
      eventKey: eventKey("reaction.changed", "reaction-operation-2"),
      operation: "remove" as const,
    };
    const ascendingKeyOrder = createReactionProjection();
    const descendingKeyOrder = createReactionProjection();

    expect(ascendingKeyOrder.apply(first)).toBe(true);
    expect(ascendingKeyOrder.apply(laterKey)).toBe(true);
    expect(descendingKeyOrder.apply(laterKey)).toBe(true);
    expect(descendingKeyOrder.apply(first)).toBe(false);
    expect(
      ascendingKeyOrder.read(first.officeChannelId, first.messageId),
    ).toEqual(descendingKeyOrder.read(first.officeChannelId, first.messageId));
    expect(
      descendingKeyOrder.read(first.officeChannelId, first.messageId),
    ).toEqual([]);
  });

  test("keeps participant ownership isolated while folding counts", () => {
    const first = supportedEvents[0];
    if (first.type !== "reaction.changed") {
      throw new Error("Expected the reaction fixture first.");
    }
    const colleague = {
      ...first,
      eventKey: eventKey("reaction.changed", "colleague-add"),
      actorId: "user_colleague",
    };
    const ownerRemoves = {
      ...first,
      eventKey: eventKey("reaction.changed", "owner-remove"),
      occurredAt: "2026-07-22T12:01:00.000Z",
      operation: "remove" as const,
    };
    const projection = createReactionProjection();

    projection.apply(first);
    projection.apply(colleague);
    expect(projection.read(first.officeChannelId, first.messageId)).toEqual([
      {
        reaction: "👍",
        actorIds: ["user_colleague", "user_reactor"],
      },
    ]);
    projection.apply(ownerRemoves);
    expect(projection.read(first.officeChannelId, first.messageId)).toEqual([
      { reaction: "👍", actorIds: ["user_colleague"] },
    ]);
  });

  test("ignores reactions targeting missing or cross-channel messages", () => {
    const reaction = supportedEvents[0];
    if (reaction.type !== "reaction.changed") {
      throw new Error("Expected the reaction fixture first.");
    }
    const projection = createReactionProjection({
      isValidTarget: (officeChannelId, messageId) =>
        officeChannelId === "general:2026-07-22" && messageId === "message-1",
    });

    expect(
      projection.apply({
        ...reaction,
        eventKey: eventKey("reaction.changed", "missing-message"),
        messageId: "message-missing",
      }),
    ).toBe(false);
    expect(
      projection.apply({
        ...reaction,
        eventKey: eventKey("reaction.changed", "wrong-channel"),
        officeChannelId: "watercooler:2026-07-22",
      }),
    ).toBe(false);
    expect(projection.apply(reaction)).toBe(true);
    expect(projection.read("general:2026-07-22", "message-1")).toEqual([
      { reaction: "👍", actorIds: ["user_reactor"] },
    ]);
  });

  test("mutes and clears only the hidden channel inbox entry", () => {
    const actions: string[] = [];
    silenceOfficeEventAttention({
      muted: false,
      unread: 3,
      mute: () => actions.push("mute"),
      markAsRead: () => actions.push("read"),
    });
    expect(actions).toEqual(["mute", "read"]);

    actions.length = 0;
    silenceOfficeEventAttention({
      muted: true,
      unread: 0,
      mute: () => actions.push("mute"),
      markAsRead: () => actions.push("read"),
    });
    expect(actions).toEqual([]);
  });
});
