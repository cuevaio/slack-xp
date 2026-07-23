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
type StoredState = { lastBatchSeq: number; reactions: Reactions };

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

  private state: StoredState = { lastBatchSeq: -1, reactions: {} };

  constructor(private context: ExtensionContext) {}

  async onInit() {
    this.state =
      (await this.context.storage.get<StoredState>("state")) ?? this.state;
  }

  async onBatch({ batchSeq, messages }: BatchRequest) {
    if (batchSeq <= this.state.lastBatchSeq) return;
    const changed = new Set<string>();
    for (const message of messages) {
      if (message.type !== "reaction.toggle") continue;
      const toggle = parseToggle(message.content);
      if (!toggle) continue;
      const messageReactions = this.state.reactions[toggle.messageId] ?? {};
      this.state.reactions[toggle.messageId] = messageReactions;
      const users = messageReactions[toggle.reaction] ?? [];
      messageReactions[toggle.reaction] = users;
      const existing = users.indexOf(message.senderId);
      if (existing >= 0) users.splice(existing, 1);
      else users.push(message.senderId);
      changed.add(toggle.messageId);
    }
    this.state.lastBatchSeq = batchSeq;
    while (Object.keys(this.state.reactions).length > MAX_MESSAGES) {
      const oldest = Object.keys(this.state.reactions)[0];
      delete this.state.reactions[oldest];
    }
    await this.context.storage.put("state", this.state);
    if (changed.size === 0) return;
    return {
      broadcasts: [...changed].map((messageId) => ({
        type: "reaction.state",
        content: { messageId, reactions: this.state.reactions[messageId] },
      })),
      snapshotDirty: true,
    };
  }

  onSnapshot() {
    return { snapshot: { reactions: this.state.reactions } };
  }
}

export { REACTIONS };
export default defineExtension(ReactionExtension);
