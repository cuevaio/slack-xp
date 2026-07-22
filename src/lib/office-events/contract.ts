export const OFFICE_EVENT_VERSION = 1 as const;
export const OFFICE_EVENT_MESSAGE_TYPE = "office.event" as const;
export const OFFICE_EVENT_PAYLOAD_LIMIT = 2_048;

export const OFFICE_EVENT_SENDERS = {
  profiles: "office-events:profiles",
  operations: "office-events:operations",
} as const;

export const OFFICE_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🎉"] as const;
const EVENT_TYPES = [
  "reaction.changed",
  "profile.invalidated",
  "report.invalidated",
  "message-removal.invalidated",
  "employment.invalidated",
  "operator.invalidated",
] as const;

export type OfficeReaction = (typeof OFFICE_REACTIONS)[number];
export type OfficeEventType = (typeof EVENT_TYPES)[number];

type OfficeEventBase<TType extends OfficeEventType> = {
  version: typeof OFFICE_EVENT_VERSION;
  type: TType;
  eventKey: string;
  occurredAt: string;
};

export type ReactionOfficeEvent = OfficeEventBase<"reaction.changed"> & {
  officeDay: string;
  officeChannelId: string;
  messageId: string;
  actorId: string;
  reaction: OfficeReaction;
  operation: "add" | "remove";
};

export type OfficeInvalidationEvent =
  | (OfficeEventBase<"profile.invalidated"> & { profileId: string })
  | (OfficeEventBase<"report.invalidated"> & { reportId: string })
  | (OfficeEventBase<"message-removal.invalidated"> & { messageId: string })
  | (OfficeEventBase<"employment.invalidated"> & { newHireId: string })
  | (OfficeEventBase<"operator.invalidated"> & { operatorId: string });

export type OfficeEvent = ReactionOfficeEvent | OfficeInvalidationEvent;

export type OfficeEventHandlers = {
  onReaction(event: ReactionOfficeEvent): void;
  onInvalidation(event: OfficeInvalidationEvent): void;
};

export type SafeOfficeEventMessage = {
  id: string;
  senderId: string;
  timestamp: number;
  event: OfficeEvent;
};

export type OfficeEventDispatchResult =
  | "ignored"
  | "duplicate"
  | "reaction"
  | "invalidation";

export type OfficeEventDispatcher = {
  dispatch(message: unknown): OfficeEventDispatchResult;
};

const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,254}$/u;
const OFFICE_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const BASE_KEYS = ["version", "type", "eventKey", "occurredAt"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    value.trim() === value &&
    IDENTIFIER_PATTERN.test(value)
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = new Date(value);
  return (
    Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
  );
}

function serializedSize(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? null
      : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
}

function isOfficeEventType(value: unknown): value is OfficeEventType {
  return EVENT_TYPES.some((type) => type === value);
}

function hasValidBase(
  value: Record<string, unknown>,
  type: OfficeEventType,
): boolean {
  const eventKeyPrefix = officeEventKeyPrefix(type);
  return (
    value.version === OFFICE_EVENT_VERSION &&
    value.type === type &&
    isCanonicalTimestamp(value.occurredAt) &&
    typeof value.eventKey === "string" &&
    value.eventKey.startsWith(eventKeyPrefix) &&
    SOURCE_ID_PATTERN.test(value.eventKey.slice(eventKeyPrefix.length))
  );
}

function officeEventKeyPrefix(type: OfficeEventType): string {
  return `office-event:v${OFFICE_EVENT_VERSION}:${type}:`;
}

function isReactionOfficeEvent(value: unknown): value is ReactionOfficeEvent {
  if (!isObject(value)) return false;
  return (
    hasExactKeys(value, [
      ...BASE_KEYS,
      "officeDay",
      "officeChannelId",
      "messageId",
      "actorId",
      "reaction",
      "operation",
    ]) &&
    hasValidBase(value, "reaction.changed") &&
    typeof value.officeDay === "string" &&
    isValidOfficeDay(value.officeDay) &&
    isIdentifier(value.officeChannelId) &&
    !value.officeChannelId.endsWith(":office-events") &&
    value.officeChannelId.endsWith(`:${value.officeDay}`) &&
    isIdentifier(value.messageId) &&
    isIdentifier(value.actorId) &&
    OFFICE_REACTIONS.some((reaction) => reaction === value.reaction) &&
    (value.operation === "add" || value.operation === "remove")
  );
}

function hasValidInvalidation(
  value: Record<string, unknown>,
  type: OfficeInvalidationEvent["type"],
  identifierKey:
    | "profileId"
    | "reportId"
    | "messageId"
    | "newHireId"
    | "operatorId",
): boolean {
  return (
    hasExactKeys(value, [...BASE_KEYS, identifierKey]) &&
    hasValidBase(value, type) &&
    isIdentifier(value[identifierKey])
  );
}

function isOfficeInvalidationEvent(
  value: unknown,
): value is OfficeInvalidationEvent {
  if (!isObject(value)) return false;
  switch (value.type) {
    case "profile.invalidated":
      return hasValidInvalidation(value, value.type, "profileId");
    case "report.invalidated":
      return hasValidInvalidation(value, value.type, "reportId");
    case "message-removal.invalidated":
      return hasValidInvalidation(value, value.type, "messageId");
    case "employment.invalidated":
      return hasValidInvalidation(value, value.type, "newHireId");
    case "operator.invalidated":
      return hasValidInvalidation(value, value.type, "operatorId");
    default:
      return false;
  }
}

function isValidOfficeDay(value: string): boolean {
  if (!OFFICE_DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function officeEventChannelId(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)}:office-events`;
}

export function officeEventChannelIdForDay(officeDay: string): string {
  if (!isValidOfficeDay(officeDay)) {
    throw new TypeError("A valid UTC Office Day is required.");
  }
  return `${officeDay}:office-events`;
}

export function isOfficeEventChannelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const [officeDay, channelName, extra] = value.split(":");
  return (
    extra === undefined &&
    channelName === "office-events" &&
    officeDay !== undefined &&
    isValidOfficeDay(officeDay)
  );
}

export function createOfficeEventKey(
  type: OfficeEventType,
  sourceId: string,
): string {
  if (!isOfficeEventType(type) || !SOURCE_ID_PATTERN.test(sourceId)) {
    throw new TypeError(
      "A valid Office Event type and stable source identifier are required.",
    );
  }
  return `${officeEventKeyPrefix(type)}${sourceId}`;
}

export function createReactionOfficeEvent({
  mutationId,
  occurredAt,
  officeDay,
  officeChannelId,
  messageId,
  actorId,
  reaction,
  operation,
}: Omit<ReactionOfficeEvent, "version" | "type" | "eventKey"> & {
  mutationId: string;
}): ReactionOfficeEvent {
  const event: ReactionOfficeEvent = {
    version: OFFICE_EVENT_VERSION,
    type: "reaction.changed",
    eventKey: createOfficeEventKey("reaction.changed", mutationId),
    occurredAt,
    officeDay,
    officeChannelId,
    messageId,
    actorId,
    reaction,
    operation,
  };
  if (!isReactionOfficeEvent(event)) {
    throw new TypeError(
      "A valid reaction mutation in the same Office Day and Office Channel is required.",
    );
  }
  return event;
}

export function parseOfficeEvent(value: unknown): OfficeEvent | null {
  const size = serializedSize(value);
  if (!isObject(value) || size === null || size > OFFICE_EVENT_PAYLOAD_LIMIT) {
    return null;
  }

  switch (value.type) {
    case "reaction.changed":
      return isReactionOfficeEvent(value) ? value : null;
    case "profile.invalidated":
    case "report.invalidated":
    case "message-removal.invalidated":
    case "employment.invalidated":
    case "operator.invalidated":
      return isOfficeInvalidationEvent(value) ? value : null;
    default:
      return null;
  }
}

function isTrustedSender(event: OfficeEvent, senderId: string): boolean {
  if (event.type === "reaction.changed") {
    return (
      senderId === event.actorId &&
      senderId !== OFFICE_EVENT_SENDERS.profiles &&
      senderId !== OFFICE_EVENT_SENDERS.operations
    );
  }
  if (event.type === "profile.invalidated") {
    return senderId === OFFICE_EVENT_SENDERS.profiles;
  }
  return senderId === OFFICE_EVENT_SENDERS.operations;
}

export function parseOfficeEventMessage(
  value: unknown,
  expectedChannelId: string,
): SafeOfficeEventMessage | null {
  if (
    !isObject(value) ||
    !isOfficeEventChannelId(expectedChannelId) ||
    !isIdentifier(value.id) ||
    value.channelId !== expectedChannelId ||
    !isObject(value.sender) ||
    !isIdentifier(value.sender.id) ||
    value.sender.anon !== false ||
    typeof value.timestamp !== "number" ||
    !Number.isSafeInteger(value.timestamp) ||
    value.timestamp < 0 ||
    !Number.isFinite(new Date(value.timestamp).getTime()) ||
    value.kind !== "text" ||
    value.type !== OFFICE_EVENT_MESSAGE_TYPE ||
    value.ephemeral !== false ||
    value.retracted !== false ||
    value.status !== "sent"
  ) {
    return null;
  }

  const event = parseOfficeEvent(value.content);
  if (!event || !isTrustedSender(event, value.sender.id)) return null;
  if (
    event.type === "reaction.changed" &&
    (event.officeDay !== expectedChannelId.slice(0, 10) ||
      !event.officeChannelId.endsWith(`:${event.officeDay}`))
  ) {
    return null;
  }

  return {
    id: value.id,
    senderId: value.sender.id,
    timestamp: value.timestamp,
    event,
  };
}

export function createOfficeEventDispatcher({
  channelId,
  onReaction,
  onInvalidation,
  dedupeLimit = 2_048,
}: OfficeEventHandlers & {
  channelId: string;
  dedupeLimit?: number;
}): OfficeEventDispatcher {
  if (!Number.isSafeInteger(dedupeLimit) || dedupeLimit < 1) {
    throw new TypeError(
      "The Office Event dedupe limit must be a positive integer.",
    );
  }
  const seenEventKeys = new Set<string>();

  function rememberEventKey(eventKey: string): boolean {
    if (seenEventKeys.has(eventKey)) return false;
    seenEventKeys.add(eventKey);
    if (seenEventKeys.size > dedupeLimit) {
      const oldestEventKey = seenEventKeys.values().next().value;
      if (oldestEventKey !== undefined) seenEventKeys.delete(oldestEventKey);
    }
    return true;
  }

  return {
    dispatch(message: unknown): OfficeEventDispatchResult {
      const parsed = parseOfficeEventMessage(message, channelId);
      if (!parsed) return "ignored";
      if (!rememberEventKey(parsed.event.eventKey)) return "duplicate";

      if (parsed.event.type === "reaction.changed") {
        onReaction(parsed.event);
        return "reaction";
      }
      onInvalidation(parsed.event);
      return "invalidation";
    },
  };
}

export type ProjectedOfficeReaction = {
  reaction: OfficeReaction;
  actorIds: readonly string[];
};

export type OfficeReactionProjection = {
  apply(event: ReactionOfficeEvent): boolean;
  read(
    officeChannelId: string,
    messageId: string,
  ): readonly ProjectedOfficeReaction[];
};

export function createReactionProjection({
  isValidTarget = () => true,
}: {
  isValidTarget?: (officeChannelId: string, messageId: string) => boolean;
} = {}): OfficeReactionProjection {
  const seenEventKeys = new Set<string>();
  const latestEvents = new Map<string, ReactionOfficeEvent>();

  function reactionStateKey(event: ReactionOfficeEvent): string {
    return [
      event.officeChannelId,
      event.messageId,
      event.reaction,
      event.actorId,
    ].join("\u0000");
  }

  function isLaterEvent(
    event: ReactionOfficeEvent,
    previous: ReactionOfficeEvent,
  ): boolean {
    if (event.occurredAt !== previous.occurredAt) {
      return event.occurredAt > previous.occurredAt;
    }
    return event.eventKey > previous.eventKey;
  }

  return {
    apply(event: ReactionOfficeEvent): boolean {
      if (seenEventKeys.has(event.eventKey)) return false;
      if (!isValidTarget(event.officeChannelId, event.messageId)) return false;
      seenEventKeys.add(event.eventKey);

      const key = reactionStateKey(event);
      const previous = latestEvents.get(key);
      if (previous && !isLaterEvent(event, previous)) return false;
      latestEvents.set(key, event);
      return true;
    },

    read(
      officeChannelId: string,
      messageId: string,
    ): readonly ProjectedOfficeReaction[] {
      const actorsByReaction = new Map<OfficeReaction, string[]>();
      for (const event of latestEvents.values()) {
        if (
          event.officeChannelId !== officeChannelId ||
          event.messageId !== messageId ||
          event.operation !== "add"
        ) {
          continue;
        }
        const actors = actorsByReaction.get(event.reaction) ?? [];
        actors.push(event.actorId);
        actorsByReaction.set(event.reaction, actors);
      }
      const projectedReactions: ProjectedOfficeReaction[] = [];
      for (const reaction of OFFICE_REACTIONS) {
        const actors = actorsByReaction.get(reaction);
        if (actors && actors.length > 0) {
          projectedReactions.push({
            reaction,
            actorIds: actors.sort(),
          });
        }
      }
      return projectedReactions;
    },
  };
}
