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
  historyPage(
    channelId: string,
    options: { before?: string; limit: number },
  ): Promise<{
    messages: readonly PortalChatMessage[];
    hasPrevious: boolean;
  }>;
  sendMessage(input: {
    channelId: string;
    senderId: string;
    content: unknown;
  }): Promise<PortalChatMessage>;
  inbox(
    userId: string,
    channelIds: readonly string[],
  ): readonly MockPortalInboxEntry[];
  markInboxRead(userId: string, channelId: string): void;
  membershipCount(channelId: string): number;
  failNextSend(): void;
  setOnline(online: boolean): void;
  reset(): void;
};

export type MockPortalInboxEntry = {
  channelId: string;
  unread: number;
  latest: {
    text: string;
    senderId: string;
    at: number;
  } | null;
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
  const inboxWatermarks = new Map<string, Map<string, number>>();
  let online = true;
  let rejectNextSend = false;
  let tokenSequence = 0;
  let messageSequence = 0;

  function requireOnline(): void {
    if (!online) {
      throw new MockPortalUnavailableError();
    }
  }

  function setInboxWatermark(
    userId: string,
    channelId: string,
    messageCount: number,
  ): void {
    const userWatermarks = inboxWatermarks.get(userId) ?? new Map();
    userWatermarks.set(channelId, messageCount);
    inboxWatermarks.set(userId, userWatermarks);
  }

  return {
    async ensureMembership({ channelId, userId, claims }) {
      requireOnline();
      const channelMembers = members.get(channelId) ?? new Map();
      const isNewMember = !channelMembers.has(userId);
      channelMembers.set(userId, claims);
      members.set(channelId, channelMembers);
      if (isNewMember) {
        setInboxWatermark(
          userId,
          channelId,
          messages.get(channelId)?.length ?? 0,
        );
      }
    },

    async mintToken({ channelIds, userId }: PortalTokenInput) {
      requireOnline();
      const hasAllMemberships =
        channelIds.length > 0 &&
        channelIds.every((channelId) => members.get(channelId)?.has(userId));
      if (!hasAllMemberships) {
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

    async historyPage(channelId, { before, limit }) {
      requireOnline();
      const channelMessages = messages.get(channelId) ?? [];
      const beforeIndex = before
        ? channelMessages.findIndex(({ id }) => id === before)
        : -1;
      const end = beforeIndex >= 0 ? beforeIndex : channelMessages.length;
      const start = Math.max(0, end - limit);
      return {
        messages: channelMessages.slice(start, end),
        hasPrevious: start > 0,
      };
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
      setInboxWatermark(senderId, channelId, channelMessages.length);
      return message;
    },

    inbox(userId, channelIds) {
      requireOnline();
      const userWatermarks = inboxWatermarks.get(userId) ?? new Map();
      return channelIds.map((channelId) => {
        const channelMessages = messages.get(channelId) ?? [];
        const latest = channelMessages.at(-1);
        return {
          channelId,
          unread: Math.max(
            0,
            channelMessages.length - (userWatermarks.get(channelId) ?? 0),
          ),
          latest: latest
            ? {
                text: latest.content.text,
                senderId: latest.sender.id,
                at: latest.timestamp,
              }
            : null,
        };
      });
    },

    markInboxRead(userId, channelId) {
      requireOnline();
      setInboxWatermark(
        userId,
        channelId,
        messages.get(channelId)?.length ?? 0,
      );
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
      inboxWatermarks.clear();
      online = true;
      rejectNextSend = false;
      tokenSequence = 0;
      messageSequence = 0;
    },
  };
}
