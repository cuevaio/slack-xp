import type { Message } from "@portalsdk/core";

export const REACTIONS = ["like", "love", "laugh", "surprise"] as const;
export const REACTION_EVENT_TYPE = "app.reaction.toggle";

export type Reaction = (typeof REACTIONS)[number];
export type ReactionState = Record<string, Partial<Record<Reaction, string[]>>>;
export type ReactionToggleContent = {
  targetMessageId: string;
  reaction: Reaction;
  mutationId: string;
};

function parseReactionToggle(content: unknown): ReactionToggleContent | null {
  if (typeof content !== "object" || content === null) return null;
  const targetMessageId =
    "targetMessageId" in content ? content.targetMessageId : undefined;
  const reaction = "reaction" in content ? content.reaction : undefined;
  const mutationId = "mutationId" in content ? content.mutationId : undefined;
  if (
    typeof targetMessageId !== "string" ||
    targetMessageId.length === 0 ||
    targetMessageId.length > 200 ||
    typeof reaction !== "string" ||
    !REACTIONS.includes(reaction as Reaction) ||
    typeof mutationId !== "string" ||
    mutationId.length === 0 ||
    mutationId.length > 200
  ) {
    return null;
  }
  return {
    targetMessageId,
    reaction: reaction as Reaction,
    mutationId,
  };
}

export function createReactionToggle(
  targetMessageId: string,
  reaction: Reaction,
  mutationId = crypto.randomUUID(),
) {
  return {
    type: REACTION_EVENT_TYPE,
    content: { targetMessageId, reaction, mutationId },
  } as const;
}

export function projectReactions(
  messages: readonly Pick<
    Message<unknown>,
    "type" | "content" | "sender" | "retracted"
  >[],
): ReactionState {
  const projected = new Map<string, Map<Reaction, Set<string>>>();
  const seenMutations = new Set<string>();

  for (const message of messages) {
    if (message.retracted || message.type !== REACTION_EVENT_TYPE) continue;
    const toggle = parseReactionToggle(message.content);
    if (!toggle || !message.sender.id) continue;
    const mutationKey = `${message.sender.id}\0${toggle.mutationId}`;
    if (seenMutations.has(mutationKey)) continue;
    seenMutations.add(mutationKey);

    let messageReactions = projected.get(toggle.targetMessageId);
    if (!messageReactions) {
      messageReactions = new Map();
      projected.set(toggle.targetMessageId, messageReactions);
    }
    let users = messageReactions.get(toggle.reaction);
    if (!users) {
      users = new Set();
      messageReactions.set(toggle.reaction, users);
    }
    if (users.has(message.sender.id)) users.delete(message.sender.id);
    else users.add(message.sender.id);
  }

  const reactions: ReactionState = {};
  for (const [messageId, messageReactions] of projected) {
    const visibleReactions: Partial<Record<Reaction, string[]>> = {};
    for (const [reaction, users] of messageReactions) {
      if (users.size > 0) visibleReactions[reaction] = [...users];
    }
    if (Object.keys(visibleReactions).length > 0) {
      reactions[messageId] = visibleReactions;
    }
  }
  return reactions;
}
