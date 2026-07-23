import type {
  PublicSendHomeSystemEvent,
  PublicTerminationSystemEvent,
} from "@/lib/employment/contract";
import type { ScriptedSystemEvent } from "@/lib/office-days/contract";
import type { OfficeEvent } from "@/lib/office-events/contract";
import type { PortalChatContent } from "@/lib/portal/chat";

export type PortalMembershipInput = {
  channelId: string;
  userId: string;
  claims: {
    username: string;
    avatar: string | null;
  };
};

export type PortalTokenInput = {
  channelIds: readonly string[];
  userId: string;
  claims: PortalMembershipInput["claims"];
  capabilities?: readonly string[];
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
  mentions?: { userId: string }[];
  unread: boolean;
  status: "sent";
};

export type PortalScriptedSystemEventMessage = {
  id: string;
  channelId: string;
  sender: {
    id: string;
    anon: false;
  };
  timestamp: number;
  retracted: false;
  ephemeral: false;
  kind: "text";
  type: "system.event";
  content: ScriptedSystemEvent;
  unread: boolean;
  status: "sent";
};

export type PortalEmploymentSystemEventMessage = Omit<
  PortalScriptedSystemEventMessage,
  "content"
> & {
  content: PublicSendHomeSystemEvent | PublicTerminationSystemEvent;
};

export type PortalVisibleMessage =
  | PortalChatMessage
  | PortalScriptedSystemEventMessage
  | PortalEmploymentSystemEventMessage;

export type PortalOfficeEventMessage<TEvent extends OfficeEvent = OfficeEvent> =
  {
    id: string;
    channelId: string;
    sender: {
      id: string;
      anon: false;
    };
    timestamp: number;
    retracted: false;
    ephemeral: false;
    kind: "text";
    type: "office.event";
    content: TEvent;
    unread: boolean;
    status: "sent";
  };
