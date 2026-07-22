import {
  OFFICE_EVENT_MESSAGE_TYPE,
  OFFICE_EVENT_SENDERS,
  officeEventChannelId,
} from "@/lib/office-events/contract";
import { parseChatContent } from "@/lib/portal/chat";
import type {
  PortalAuthority,
  PortalChatMessage,
  PortalMembershipInput,
  PortalTokenInput,
} from "@/lib/portal/types";
import type {
  ProfileInvalidationEvent,
  ProfileInvalidationPublisher,
} from "@/lib/profiles/types";

export class MockPortalUnavailableError extends Error {
  constructor() {
    super("Portal is temporarily unavailable.");
    this.name = "MockPortalUnavailableError";
  }
}

export type MockPortalAdapter = PortalAuthority &
  ProfileInvalidationPublisher & {
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
    failNextSend(): void;
    setOnline(online: boolean): void;
    officeEvents(channelId: string): readonly unknown[];
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
  const officeEvents = new Map<string, unknown[]>();
  let online = true;
  let rejectNextSend = false;
  let tokenSequence = 0;
  let messageSequence = 0;

  function requireOnline(): void {
    if (!online) {
      throw new MockPortalUnavailableError();
    }
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

    async publishProfileInvalidation(event: ProfileInvalidationEvent) {
      requireOnline();
      const channelId = officeEventChannelId(now());
      const channelEvents = officeEvents.get(channelId) ?? [];
      messageSequence += 1;
      channelEvents.push({
        id: `mock_office_event_${messageSequence}`,
        channelId,
        sender: { id: OFFICE_EVENT_SENDERS.profiles, anon: false },
        timestamp: now().getTime(),
        kind: "text",
        type: OFFICE_EVENT_MESSAGE_TYPE,
        ephemeral: false,
        retracted: false,
        status: "sent",
        content: event,
      });
      officeEvents.set(channelId, channelEvents);
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

    failNextSend() {
      rejectNextSend = true;
    },

    setOnline(nextOnline) {
      online = nextOnline;
    },

    officeEvents(channelId) {
      return [...(officeEvents.get(channelId) ?? [])];
    },

    reset() {
      members.clear();
      messages.clear();
      officeEvents.clear();
      online = true;
      rejectNextSend = false;
      tokenSequence = 0;
      messageSequence = 0;
    },
  };
}
