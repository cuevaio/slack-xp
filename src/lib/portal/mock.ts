import { parseChatContent } from "@/lib/portal/chat";
import type {
  PortalAuthority,
  PortalChatMessage,
  PortalMembershipInput,
  PortalTokenInput,
} from "@/lib/portal/types";

export class MockPortalUnavailableError extends Error {
  constructor() {
    super("Portal is temporarily unavailable.");
    this.name = "MockPortalUnavailableError";
  }
}

export type MockPortalAdapter = PortalAuthority & {
  history(channelId: string): Promise<readonly PortalChatMessage[]>;
  sendMessage(input: {
    channelId: string;
    senderId: string;
    content: unknown;
  }): Promise<PortalChatMessage>;
  membershipCount(channelId: string): number;
  failNextSend(): void;
  setOnline(online: boolean): void;
  reset(): void;
};

export function createMockPortalAdapter({
  now = () => new Date(),
}: {
  now?: () => Date;
} = {}): MockPortalAdapter {
  const members = new Map<
    string,
    Map<string, PortalMembershipInput["claims"]>
  >();
  const messages = new Map<string, PortalChatMessage[]>();
  let online = true;
  let rejectNextSend = false;
  let tokenSequence = 0;
  let messageSequence = 0;

  function requireOnline(): void {
    if (!online) throw new MockPortalUnavailableError();
  }

  return {
    async ensureMembership({ channelId, userId, claims }) {
      requireOnline();
      const channelMembers = members.get(channelId) ?? new Map();
      channelMembers.set(userId, claims);
      members.set(channelId, channelMembers);
    },

    async mintToken({ channelIds, userId }: PortalTokenInput) {
      requireOnline();
      if (
        channelIds.length === 0 ||
        channelIds.some((channelId) => !members.get(channelId)?.has(userId))
      ) {
        throw new MockPortalUnavailableError();
      }
      tokenSequence += 1;
      return {
        token: `mock_portal_token_${tokenSequence}`,
        expiresAt: new Date(now().getTime() + 15 * 60 * 1_000).toISOString(),
      };
    },

    async history(channelId) {
      requireOnline();
      return [...(messages.get(channelId) ?? [])];
    },

    async sendMessage({ channelId, senderId, content }) {
      requireOnline();
      if (rejectNextSend) {
        rejectNextSend = false;
        throw new MockPortalUnavailableError();
      }
      if (!members.get(channelId)?.has(senderId)) {
        throw new MockPortalUnavailableError();
      }
      const validatedContent = parseChatContent(content);
      if (!validatedContent) {
        throw new TypeError("Invalid Portal chat payload.");
      }
      messageSequence += 1;
      const message: PortalChatMessage = {
        id: `mock_message_${messageSequence}`,
        channelId,
        sender: { id: senderId, anon: false },
        timestamp: now().getTime(),
        retracted: false,
        ephemeral: false,
        kind: "text",
        type: "message",
        content: validatedContent,
        unread: false,
        status: "sent",
      };
      const channelMessages = messages.get(channelId) ?? [];
      channelMessages.push(message);
      messages.set(channelId, channelMessages);
      return message;
    },

    membershipCount(channelId) {
      return members.get(channelId)?.size ?? 0;
    },

    failNextSend() {
      rejectNextSend = true;
    },

    setOnline(nextOnline) {
      online = nextOnline;
    },

    reset() {
      members.clear();
      messages.clear();
      online = true;
      rejectNextSend = false;
      tokenSequence = 0;
      messageSequence = 0;
    },
  };
}
