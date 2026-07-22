import type { OfficeInvalidationEvent } from "@/lib/office-events/contract";

export const MESSAGE_REMOVAL_PRIVATE_REASON_MAX_LENGTH = 1_000;

export type MessageRemovalInvalidationEvent = Extract<
  OfficeInvalidationEvent,
  { type: "message-removal.invalidated" }
>;

export type MessageRemovalStableContext = {
  officeDay: string;
  officeChannelId: string;
  messageId: string;
};

export type MessageRemovalRequest = Omit<
  MessageRemovalStableContext,
  "officeDay"
> & {
  privateReason: string;
};

export type MessageRemovalProjection = MessageRemovalStableContext & {
  removalId: string;
  removedAt: Date;
};

export type SerializedMessageRemovalProjection = Omit<
  MessageRemovalProjection,
  "removedAt"
> & {
  removedAt: string;
};

export type CreateMessageRemovalInput = MessageRemovalStableContext & {
  removalId: string;
  actionId: string;
  operatorId: string;
  privateReason: string;
  removedAt: Date;
};

export type CreateMessageRemovalResult = {
  status: "removed" | "already-removed";
  removal: MessageRemovalProjection;
};

export type PendingMessageRemovalInvalidation = {
  outboxId: string;
  removalId: string;
  messageId: string;
  occurredAt: Date;
};

export type MessageRemovalRepository = {
  createMessageRemoval(
    input: CreateMessageRemovalInput,
  ): Promise<CreateMessageRemovalResult>;
  listMessageRemovals(
    officeChannelId: string,
  ): Promise<MessageRemovalProjection[]>;
  pendingMessageRemovalInvalidations(
    limit: number,
  ): Promise<PendingMessageRemovalInvalidation[]>;
  markMessageRemovalInvalidationPublished(
    outboxId: string,
    publishedAt: Date,
  ): Promise<void>;
};

export type MessageRemovalInvalidationPublisher = {
  publishMessageRemovalInvalidation(
    event: MessageRemovalInvalidationEvent,
  ): Promise<void>;
};
