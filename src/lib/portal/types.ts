import type { PortalChatContent } from "@/lib/portal/chat";

export type PortalMembershipInput = {
  channelId: string;
  userId: string;
  claims: {
    username: string;
    avatar: string | null;
  };
};

export type PortalTokenInput = Omit<PortalMembershipInput, "channelId"> & {
  channelIds: readonly string[];
};

export type PortalToken = {
  token: string;
  expiresAt: string;
};

export type PortalAuthority = {
  ensureMembership(input: PortalMembershipInput): Promise<void>;
  mintToken(input: PortalTokenInput): Promise<PortalToken>;
};

export type PortalChatMessage = {
  id: string;
  channelId: string;
  sender: {
    id: string;
    anon: boolean;
  };
  timestamp: number;
  retracted: false;
  ephemeral: false;
  kind: "text";
  type: "message";
  content: PortalChatContent;
  unread: boolean;
  status: "sent";
};
