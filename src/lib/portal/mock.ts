import {
  isOfficeEventChannelId,
  parseOfficeEventMessage,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";
import { parseChatContent } from "@/lib/portal/chat";
import type {
  PortalAuthority,
  PortalChatMessage,
  PortalMembershipInput,
  PortalOfficeEventMessage,
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
  officeEventHistory(
    channelId: string,
  ): Promise<readonly PortalOfficeEventMessage[]>;
  sendOfficeEvent(input: {
    channelId: string;
    senderId: string;
    content: ReactionOfficeEvent;
  }): Promise<PortalOfficeEventMessage>;
  subscribeOfficeEvents(
    channelId: string,
    userId: string,
    listener: (message: PortalOfficeEventMessage) => void,
  ): () => void;
  unreadCount(channelId: string, userId: string): number;
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
  const officeEvents = new Map<string, PortalOfficeEventMessage[]>();
  const officeEventListeners = new Map<
    string,
    Set<(message: PortalOfficeEventMessage) => void>
  >();
  const unreadCounts = new Map<string, Map<string, number>>();
  let online = true;
  let rejectNextSend = false;
  let tokenSequence = 0;
  let messageSequence = 0;

  function requireOnline(): void {
    if (!online) {
      throw new MockPortalUnavailableError();
    }
  }

  function incrementUnread(channelId: string, senderId: string): void {
    const channelUnread = unreadCounts.get(channelId) ?? new Map();
    for (const userId of members.get(channelId)?.keys() ?? []) {
      if (userId !== senderId) {
        channelUnread.set(userId, (channelUnread.get(userId) ?? 0) + 1);
      }
    }
    unreadCounts.set(channelId, channelUnread);
  }

  return {
    async ensureMembership({ channelId, userId, claims }) {
      requireOnline();
      const channelMembers = members.get(channelId) ?? new Map();
      channelMembers.set(userId, claims);
      members.set(channelId, channelMembers);
      const channelUnread = unreadCounts.get(channelId) ?? new Map();
      channelUnread.set(userId, channelUnread.get(userId) ?? 0);
      unreadCounts.set(channelId, channelUnread);
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
      incrementUnread(channelId, senderId);
      return message;
    },

    async officeEventHistory(channelId) {
      requireOnline();
      return [...(officeEvents.get(channelId) ?? [])];
    },

    async sendOfficeEvent({ channelId, senderId, content }) {
      requireOnline();
      if (
        !isOfficeEventChannelId(channelId) ||
        !members.get(channelId)?.has(senderId)
      ) {
        throw new MockPortalUnavailableError();
      }
      const message: PortalOfficeEventMessage = {
        id: `mock_office_event_${++messageSequence}`,
        channelId,
        sender: { id: senderId, anon: false },
        timestamp: now().getTime(),
        retracted: false,
        ephemeral: false,
        kind: "text",
        type: "office.event",
        content,
        unread: false,
        status: "sent",
      };
      const parsed = parseOfficeEventMessage(message, channelId);
      if (!parsed || parsed.event.type !== "reaction.changed") {
        throw new TypeError("Invalid reaction Office Event.");
      }
      const targetExists = (messages.get(content.officeChannelId) ?? []).some(
        ({ id }) => id === content.messageId,
      );
      if (!targetExists) {
        throw new TypeError("Invalid reaction target.");
      }
      const channelEvents = officeEvents.get(channelId) ?? [];
      channelEvents.push(message);
      officeEvents.set(channelId, channelEvents);
      incrementUnread(channelId, senderId);
      for (const listener of officeEventListeners.get(channelId) ?? []) {
        listener(message);
      }
      return message;
    },

    subscribeOfficeEvents(channelId, userId, listener) {
      requireOnline();
      if (!members.get(channelId)?.has(userId)) {
        throw new MockPortalUnavailableError();
      }
      const listeners = officeEventListeners.get(channelId) ?? new Set();
      listeners.add(listener);
      officeEventListeners.set(channelId, listeners);
      return () => {
        listeners.delete(listener);
      };
    },

    unreadCount(channelId, userId) {
      return unreadCounts.get(channelId)?.get(userId) ?? 0;
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
      officeEvents.clear();
      officeEventListeners.clear();
      unreadCounts.clear();
      online = true;
      rejectNextSend = false;
      tokenSequence = 0;
      messageSequence = 0;
    },
  };
}
