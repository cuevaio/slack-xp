import type {
  AggregatePresence,
  ChannelStatus,
  DetailedPresence,
} from "@portalsdk/core";
import {
  isOfficeEventChannelId,
  parseOfficeEventMessage,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";
import { parseChatContent } from "@/lib/portal/chat";
import { isReservedPortalIdentity } from "@/lib/portal/presence";
import type {
  PortalAuthority,
  PortalChatMessage,
  PortalMembershipInput,
  PortalOfficeEventMessage,
  PortalTokenInput,
} from "@/lib/portal/types";

const TYPING_THROTTLE_MS = 3_000;
const TYPING_EXPIRY_MS = 5_000;

type MockChannelMode = "standard" | "broadcast";

type MockConnectionState = {
  channelId: string;
  userId: string;
  mode: MockChannelMode;
  active: boolean;
  wantsReconnect: boolean;
};

type MockPresenceEvent = {
  id: string;
  action: "join" | "leave";
  at: number;
};

type MockTypingActivity = {
  sentAt: number;
  expiresAt: number;
};

export type MockPortalConnection = {
  presence(): DetailedPresence | AggregatePresence | undefined;
  typing(): readonly string[];
  sendTyping(): void;
  disconnect(): void;
  reconnect(): void;
  status(): ChannelStatus;
};

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
  connect(input: {
    clientId: string;
    channelId: string;
    userId: string;
    mode: MockChannelMode;
  }): MockPortalConnection;
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
  const connections = new Map<string, MockConnectionState>();
  const recentPresence = new Map<string, MockPresenceEvent[]>();
  const typing = new Map<string, Map<string, MockTypingActivity>>();
  const inboxWatermarks = new Map<string, Map<string, number>>();
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

  function recordPresence(
    channelId: string,
    id: string,
    action: "join" | "leave",
  ): void {
    const recent = recentPresence.get(channelId) ?? [];
    recent.push({ id, action, at: now().getTime() });
    recentPresence.set(channelId, recent.slice(-20));
  }

  function activeUserIds(channelId: string): string[] {
    const userIds = new Set<string>();
    for (const connection of connections.values()) {
      if (connection.channelId === channelId && connection.active) {
        userIds.add(connection.userId);
      }
    }
    return [...userIds];
  }

  function clearTyping(channelId: string, userId: string): void {
    typing.get(channelId)?.delete(userId);
  }

  function deactivateConnection(
    connection: MockConnectionState,
    wantsReconnect: boolean,
  ): void {
    if (!connection.active) {
      return;
    }
    connection.active = false;
    connection.wantsReconnect = wantsReconnect;
    clearTyping(connection.channelId, connection.userId);
    recordPresence(connection.channelId, connection.userId, "leave");
  }

  function currentTyping(channelId: string, ownUserId: string): string[] {
    const channelTyping = typing.get(channelId);
    if (!channelTyping) return [];
    const currentTime = now().getTime();
    const activeUsers = new Set(activeUserIds(channelId));
    for (const [userId, activity] of channelTyping) {
      if (activity.expiresAt <= currentTime || !activeUsers.has(userId)) {
        channelTyping.delete(userId);
      }
    }
    return [...channelTyping.keys()].filter((userId) => userId !== ownUserId);
  }

  function snapshotPresence(
    channelId: string,
    mode: MockChannelMode,
  ): DetailedPresence | AggregatePresence {
    const userIds = activeUserIds(channelId);
    if (mode === "broadcast") {
      return {
        kind: "aggregate",
        count: userIds.length,
        recent: [...(recentPresence.get(channelId) ?? [])],
      };
    }
    return {
      kind: "detailed",
      participants: userIds.map((id) => ({
        id,
        anon: false,
        username: members.get(channelId)?.get(id)?.username,
        metadata: undefined,
      })),
      count: userIds.length,
    };
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
      setInboxWatermark(senderId, channelId, channelMessages.length);
      incrementUnread(channelId, senderId);
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

    connect({ clientId, channelId, userId, mode }) {
      requireOnline();
      if (isReservedPortalIdentity(userId)) {
        throw new TypeError(
          "Office Characters and reserved Portal identities cannot connect to New Hire presence.",
        );
      }
      if (!members.get(channelId)?.has(userId)) {
        throw new MockPortalUnavailableError();
      }
      if (connections.has(clientId)) {
        throw new TypeError("A controlled Portal client ID must be unique.");
      }
      const connection: MockConnectionState = {
        channelId,
        userId,
        mode,
        active: true,
        wantsReconnect: true,
      };
      connections.set(clientId, connection);
      recordPresence(channelId, userId, "join");

      return {
        presence() {
          if (!online || !connection.active) return undefined;
          return snapshotPresence(channelId, mode);
        },
        typing() {
          if (!online || !connection.active || mode === "broadcast") return [];
          return currentTyping(channelId, userId);
        },
        sendTyping() {
          if (!online || !connection.active || mode === "broadcast") return;
          const currentTime = now().getTime();
          const channelTyping = typing.get(channelId) ?? new Map();
          const previous = channelTyping.get(userId);
          if (previous && currentTime - previous.sentAt < TYPING_THROTTLE_MS) {
            return;
          }
          channelTyping.set(userId, {
            sentAt: currentTime,
            expiresAt: currentTime + TYPING_EXPIRY_MS,
          });
          typing.set(channelId, channelTyping);
        },
        disconnect() {
          deactivateConnection(connection, false);
        },
        reconnect() {
          requireOnline();
          if (!connection.active) {
            connection.active = true;
            connection.wantsReconnect = true;
            recordPresence(channelId, userId, "join");
          }
        },
        status() {
          if (connection.active && online) return "ready";
          return connection.wantsReconnect ? "reconnecting" : "idle";
        },
      };
    },

    failNextSend() {
      rejectNextSend = true;
    },

    setOnline(nextOnline) {
      if (online && !nextOnline) {
        for (const connection of connections.values()) {
          deactivateConnection(connection, true);
        }
      }
      online = nextOnline;
    },

    reset() {
      members.clear();
      messages.clear();
      connections.clear();
      recentPresence.clear();
      typing.clear();
      inboxWatermarks.clear();
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
