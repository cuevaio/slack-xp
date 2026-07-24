import { REACTION_EVENT_TYPE } from "@/lib/portal/reactions";

export type MigrationHistoryMessage = {
  id: string;
  seq: number;
  type: string;
  kind: "text";
  content: unknown;
  sender: { id: string; anon: boolean; username?: string };
  timestamp: number;
  mentions?: { userId: string }[];
  retracted: boolean;
  ephemeral: boolean;
};

export type MigrationMemberRow = {
  userId: string;
  online: boolean;
  claims: Record<string, unknown>;
};

type MigrationMetadata = {
  sourceMessageId: string;
  originalTimestamp: number;
};

const CONTENT_LIMIT_BYTES = 2048;
const MAX_TARGET_MESSAGE_ID = "m".repeat(200);

export function resolveAnnouncementMembers(
  sourceMessages: readonly MigrationHistoryMessage[],
  identityMembers: readonly MigrationMemberRow[],
) {
  const identities = new Map(
    identityMembers.map((member) => [member.userId, member.claims]),
  );
  const senders = new Map(
    sourceMessages
      .filter(({ retracted }) => !retracted)
      .map((message) => [message.sender.id, message.sender]),
  );
  const members: Array<{
    userId: string;
    claims: Record<string, unknown>;
  }> = [];
  const unresolvedUserIds: string[] = [];

  for (const [userId, sender] of senders) {
    const identityClaims = identities.get(userId);
    const identityUsername = identityClaims?.username;
    const sourceUsername = sender.username;
    const username =
      typeof identityUsername === "string" && identityUsername !== userId
        ? identityUsername
        : typeof sourceUsername === "string" && sourceUsername !== userId
          ? sourceUsername
          : undefined;
    if (!username) {
      unresolvedUserIds.push(userId);
      continue;
    }
    members.push({
      userId,
      claims: { ...identityClaims, username },
    });
  }

  return { members, unresolvedUserIds };
}

export function migrationMetadata(
  content: unknown,
): MigrationMetadata | undefined {
  if (typeof content !== "object" || content === null) return undefined;
  if (!("portalMigration" in content)) return undefined;
  const metadata = content.portalMigration;
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const sourceMessageId =
    "sourceMessageId" in metadata ? metadata.sourceMessageId : undefined;
  const originalTimestamp =
    "originalTimestamp" in metadata ? metadata.originalTimestamp : undefined;
  if (
    typeof sourceMessageId !== "string" ||
    typeof originalTimestamp !== "number"
  ) {
    return undefined;
  }
  return { sourceMessageId, originalTimestamp };
}

function migratedContent(
  message: MigrationHistoryMessage,
  targetMessageId?: string,
) {
  if (typeof message.content !== "object" || message.content === null) {
    throw new Error(`Message ${message.id} has non-object content.`);
  }
  let content = message.content as Record<string, unknown>;
  if (message.type === REACTION_EVENT_TYPE) {
    if (!targetMessageId) {
      throw new Error(`Reaction ${message.id} has no migrated target.`);
    }
    content = { ...content, targetMessageId };
  }
  return {
    ...content,
    portalMigration: {
      sourceMessageId: message.id,
      originalTimestamp: message.timestamp,
    },
  };
}

function contentBytes(content: unknown) {
  return new TextEncoder().encode(JSON.stringify(content)).byteLength;
}

export function preflightAnnouncementMigration(
  sourceMessages: readonly MigrationHistoryMessage[],
) {
  const active = sourceMessages.filter(({ retracted }) => !retracted);
  const sourceMessagesById = new Map(
    active.map((message) => [message.id, message]),
  );
  const blockers: string[] = [];
  const orphanReactionIds: string[] = [];
  const migratableIds: string[] = [];

  for (const message of active) {
    let targetMessageId: string | undefined;
    if (message.type === REACTION_EVENT_TYPE) {
      const sourceTargetId =
        typeof message.content === "object" &&
        message.content !== null &&
        "targetMessageId" in message.content
          ? message.content.targetMessageId
          : undefined;
      const sourceTarget =
        typeof sourceTargetId === "string"
          ? sourceMessagesById.get(sourceTargetId)
          : undefined;
      if (
        !sourceTarget ||
        sourceTarget.type === REACTION_EVENT_TYPE ||
        sourceTarget.seq >= message.seq
      ) {
        orphanReactionIds.push(message.id);
        continue;
      }
      targetMessageId = MAX_TARGET_MESSAGE_ID;
    }

    try {
      const content = migratedContent(message, targetMessageId);
      if (contentBytes(content) > CONTENT_LIMIT_BYTES) {
        blockers.push(
          `${message.id} exceeds Portal's 2 KB content limit after migration metadata.`,
        );
        continue;
      }
      migratableIds.push(message.id);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { blockers, orphanReactionIds, migratableIds };
}

export function planAnnouncementMigration(
  sourceMessages: readonly MigrationHistoryMessage[],
  targetMessages: readonly MigrationHistoryMessage[],
) {
  const preflight = preflightAnnouncementMigration(sourceMessages);
  const migratable = new Set(preflight.migratableIds);
  const messageIds = new Map<string, string>();
  for (const message of targetMessages) {
    const metadata = migrationMetadata(message.content);
    if (metadata) messageIds.set(metadata.sourceMessageId, message.id);
  }
  const pending = sourceMessages
    .filter(({ id }) => migratable.has(id) && !messageIds.has(id))
    .toSorted((left, right) => left.seq - right.seq);
  const skipped = preflight.migratableIds.filter((id) =>
    messageIds.has(id),
  ).length;
  return { ...preflight, messageIds, pending, skipped };
}

export function createMigrationPublishBody(
  message: MigrationHistoryMessage,
  messageIds: ReadonlyMap<string, string>,
) {
  let targetMessageId: string | undefined;
  if (message.type === REACTION_EVENT_TYPE) {
    const sourceTargetId =
      typeof message.content === "object" &&
      message.content !== null &&
      "targetMessageId" in message.content
        ? message.content.targetMessageId
        : undefined;
    targetMessageId =
      typeof sourceTargetId === "string"
        ? messageIds.get(sourceTargetId)
        : undefined;
  }
  const content = migratedContent(message, targetMessageId);
  if (contentBytes(content) > CONTENT_LIMIT_BYTES) {
    throw new Error(
      `Message ${message.id} exceeds Portal's 2 KB content limit after migration metadata.`,
    );
  }
  return {
    senderId: message.sender.id,
    type: message.type,
    kind: message.kind,
    content,
  };
}
