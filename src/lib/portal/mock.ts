import type {
  AggregatePresence,
  ChannelStatus,
  DetailedPresence,
} from "@portalsdk/core";
import { parseChatContent } from "@/lib/portal/chat";
import { isReservedPortalIdentity } from "@/lib/portal/presence";
import type {
  PortalAuthority,
  PortalChatMessage,
  PortalMembershipInput,
  PortalTokenInput,
} from "@/lib/portal/types";

const TYPING_THROTTLE_MS = 3_000;
const TYPING_EXPIRY_MS = 5_000;

type MockChannelMode = "standard" | "broadcast";

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
  const connections = new Map<
    string,
    {
      channelId: string;
      userId: string;
      mode: MockChannelMode;
      active: boolean;
      wantsReconnect: boolean;
    }
  >();
  const recentPresence = new Map<
    string,
    Array<{ id: string; action: "join" | "leave"; at: number }>
  >();
  const typing = new Map<
    string,
    Map<string, { sentAt: number; expiresAt: number }>
  >();
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

  function activeConnections(channelId: string) {
    return [...connections.values()].filter(
      (connection) => connection.channelId === channelId && connection.active,
    );
  }

  function activeUserIds(channelId: string): string[] {
    return [
      ...new Set(
        activeConnections(channelId).map((connection) => connection.userId),
      ),
    ];
  }

  function clearTyping(channelId: string, userId: string): void {
    typing.get(channelId)?.delete(userId);
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

  return {
    async ensureMembership({ channelId, userId, claims }) {
      requireOnline();
      const channelMembers = members.get(channelId) ?? new Map();
      channelMembers.set(userId, claims);
      members.set(channelId, channelMembers);
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
      return message;
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
      const connection = {
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
          if (connection.active) {
            connection.active = false;
            connection.wantsReconnect = false;
            clearTyping(channelId, userId);
            recordPresence(channelId, userId, "leave");
          }
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
          if (connection.active) {
            connection.active = false;
            connection.wantsReconnect = true;
            clearTyping(connection.channelId, connection.userId);
            recordPresence(connection.channelId, connection.userId, "leave");
          }
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
      online = true;
      rejectNextSend = false;
      tokenSequence = 0;
      messageSequence = 0;
    },
  };
}
