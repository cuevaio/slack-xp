import type {
  CreateMessageRemovalResult,
  MessageRemovalInvalidationPublisher,
  MessageRemovalProjection,
  MessageRemovalRepository,
  SerializedMessageRemovalProjection,
} from "@/lib/message-removals/contract";
import {
  createOfficeEventKey,
  OFFICE_EVENT_VERSION,
} from "@/lib/office-events/contract";

const MESSAGE_REMOVAL_OUTBOX_BATCH_SIZE = 50;

type RemoveMessageResult = {
  status: CreateMessageRemovalResult["status"];
  removal: SerializedMessageRemovalProjection;
  invalidationStatus: "sent" | "pending";
};

function serializeRemoval(
  removal: MessageRemovalProjection,
): SerializedMessageRemovalProjection {
  return { ...removal, removedAt: removal.removedAt.toISOString() };
}

export async function listMessageRemovals({
  repository,
  officeChannelId,
}: {
  repository: MessageRemovalRepository;
  officeChannelId: string;
}): Promise<SerializedMessageRemovalProjection[]> {
  const removals = await repository.listMessageRemovals(officeChannelId);
  return removals.map(serializeRemoval);
}

export async function flushMessageRemovalInvalidations({
  repository,
  publisher,
}: {
  repository: MessageRemovalRepository;
  publisher: MessageRemovalInvalidationPublisher;
}): Promise<number> {
  const pending = await repository.pendingMessageRemovalInvalidations(
    MESSAGE_REMOVAL_OUTBOX_BATCH_SIZE,
  );
  let published = 0;
  for (const entry of pending) {
    await publisher.publishMessageRemovalInvalidation({
      version: OFFICE_EVENT_VERSION,
      type: "message-removal.invalidated",
      eventKey: createOfficeEventKey(
        "message-removal.invalidated",
        entry.removalId,
      ),
      occurredAt: entry.occurredAt.toISOString(),
      messageId: entry.messageId,
    });
    await repository.markMessageRemovalInvalidationPublished(
      entry.outboxId,
      new Date(),
    );
    published += 1;
  }
  return published;
}

export async function removeMessage({
  repository,
  publisher,
  operatorId,
  officeDay,
  officeChannelId,
  messageId,
  privateReason,
  now = new Date(),
}: {
  repository: MessageRemovalRepository;
  publisher: MessageRemovalInvalidationPublisher;
  operatorId: string;
  officeDay: string;
  officeChannelId: string;
  messageId: string;
  privateReason: string;
  now?: Date;
}): Promise<RemoveMessageResult> {
  const result = await repository.createMessageRemoval({
    removalId: crypto.randomUUID(),
    actionId: crypto.randomUUID(),
    operatorId,
    officeDay,
    officeChannelId,
    messageId,
    privateReason,
    removedAt: now,
  });
  let invalidationStatus: RemoveMessageResult["invalidationStatus"];
  try {
    await flushMessageRemovalInvalidations({ repository, publisher });
    invalidationStatus = "sent";
  } catch {
    invalidationStatus = "pending";
  }
  return {
    status: result.status,
    removal: serializeRemoval(result.removal),
    invalidationStatus,
  };
}
