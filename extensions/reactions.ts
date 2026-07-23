import {
  type BatchRequest,
  defineExtension,
  type ExtensionContext,
  type ExtensionManifest,
} from "@portalsdk/extension-protocol";

const REACTIONS = ["like", "love", "laugh", "surprise"] as const;
const MAX_MESSAGES = 500;

type Reaction = (typeof REACTIONS)[number];
type Reactions = Record<string, Partial<Record<Reaction, string[]>>>;
type StoredState = {
  epoch: number;
  lastBatchSeq: number;
  reactions: Reactions;
};

function parseToggle(content: unknown) {
  if (typeof content !== "object" || content === null) return null;
  const messageId = "messageId" in content ? content.messageId : undefined;
  const reaction = "reaction" in content ? content.reaction : undefined;
  if (
    typeof messageId !== "string" ||
    messageId.length === 0 ||
    messageId.length > 200 ||
    typeof reaction !== "string" ||
    !REACTIONS.includes(reaction as Reaction)
  ) {
    return null;
  }
  return { messageId, reaction: reaction as Reaction };
}

class ReactionExtension {
  static manifest: ExtensionManifest = {
    namespace: "reaction.",
    transport: "ws",
  };

  private reactions: Reactions = {};
  private epoch = -1;
  private lastBatchSeq = -1;

  constructor(private context: ExtensionContext) {}

  async onInit() {
    const stored = await this.context.storage.get<StoredState>("state");
    if (!stored) return;
    this.epoch = stored.epoch;
    this.lastBatchSeq = stored.lastBatchSeq;
    this.reactions = stored.reactions;
  }

  async onBatch({ epoch, batchSeq, messages }: BatchRequest) {
    if (epoch === this.epoch && batchSeq <= this.lastBatchSeq) return;
    if (epoch !== this.epoch) {
      this.epoch = epoch;
      this.lastBatchSeq = -1;
    }
    const changed = new Set<string>();
    for (const message of messages) {
      if (message.type !== "reaction.toggle") continue;
      const toggle = parseToggle(message.content);
      if (!toggle) continue;
      const messageReactions = this.reactions[toggle.messageId] ?? {};
      this.reactions[toggle.messageId] = messageReactions;
      const users = messageReactions[toggle.reaction] ?? [];
      messageReactions[toggle.reaction] = users;
      const existing = users.indexOf(message.senderId);
      if (existing >= 0) users.splice(existing, 1);
      else users.push(message.senderId);
      changed.add(toggle.messageId);
    }
    while (Object.keys(this.reactions).length > MAX_MESSAGES) {
      const oldest = Object.keys(this.reactions)[0];
      delete this.reactions[oldest];
    }
    this.lastBatchSeq = batchSeq;
    await this.context.storage.put("state", {
      epoch: this.epoch,
      lastBatchSeq: this.lastBatchSeq,
      reactions: this.reactions,
    } satisfies StoredState);
    if (changed.size === 0) return;
    return {
      broadcasts: [...changed].map((messageId) => ({
        type: "reaction.state",
        content: { messageId, reactions: this.reactions[messageId] },
      })),
      snapshotDirty: true,
    };
  }

  onSnapshot() {
    return { snapshot: { reactions: this.reactions } };
  }
}

export { REACTIONS };
export default defineExtension(ReactionExtension);
