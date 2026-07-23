"use client";

import { useAuth } from "@clerk/nextjs";
import {
  type AggregatePresence,
  type ChannelStatus,
  type DetailedPresence,
  type InboxStatus,
  Portal,
} from "@portalsdk/core";
import { PortalProvider, useChannel, useInbox } from "@portalsdk/react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { HRReportReviewQueue } from "@/components/hr-report-review-queue";
import { MessageHRReportControls } from "@/components/message-hr-report-controls";
import { MessageRemovalControls } from "@/components/message-removal-controls";
import { NewHireProfileContext } from "@/components/new-hire-profile-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { fetchEmploymentAccess } from "@/lib/employment/client";
import type {
  EmploymentAccessDeniedDecision,
  SafePublicSendHomeSystemEventMessage,
  SafePublicTerminationSystemEventMessage,
} from "@/lib/employment/contract";
import { getEmploymentAccessEndedCopy } from "@/lib/employment/presentation";
import { invalidateHRReportQueue } from "@/lib/hr-reports/client";
import { parseHRReportReviewTarget } from "@/lib/hr-reports/domain";
import {
  invalidateMessageRemovals,
  useMessageRemovals,
} from "@/lib/message-removals/client";
import type { SafeScriptedSystemEventMessage } from "@/lib/office-days/contract";
import { useOfficeEventSubscription } from "@/lib/office-events/client";
import {
  createReactionOfficeEvent,
  createReactionProjection,
  OFFICE_REACTIONS,
  type OfficeEvent,
  type OfficeInvalidationEvent,
  type OfficeReaction,
  officeEventChannelIdForDay,
  type ProjectedOfficeReaction,
  parseOfficeEventMessage,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";
import {
  invalidateOperatorState,
  OperatorAccessContext,
  useOperatorState,
} from "@/lib/operators/client";
import {
  listOfficeChannelsForDay,
  type OfficeChannel,
} from "@/lib/portal/channels";
import {
  CHAT_TEXT_LIMIT,
  linkifyChatText,
  type PortalChatContent,
  parsePortalChatMessage,
  type SafePortalChatMessage,
  validateChatDraft,
} from "@/lib/portal/chat";
import { createPortalTokenSource } from "@/lib/portal/client";
import {
  type OfficeInboxEntry,
  type OfficeInboxRow,
  parseOfficeInboxSnapshot,
  reconcileOfficeInbox,
} from "@/lib/portal/inbox";
import {
  formatOfficeTimestamp,
  observeOfficeDayBoundary,
  officeDay,
} from "@/lib/portal/office-day";
import {
  connectionStatusCopy,
  currentDetailedNewHireIds,
} from "@/lib/portal/presence";
import {
  isNewHireMessage,
  isPublicSendHomeSystemEventMessage,
  isPublicTerminationSystemEventMessage,
  isScriptedSystemEventMessage,
  parseOfficeChannelMessages,
  type SafeOfficeChannelMessage,
} from "@/lib/portal/visible-messages";
import {
  invalidateProfileBatches,
  useProfileBatch,
} from "@/lib/profiles/client";
import { ProfileQueryProvider } from "@/lib/profiles/provider";
import type { ProfileAttribution } from "@/lib/profiles/types";
import {
  useApplicationSafetyControl,
  useSafetyProjectionStatus,
} from "@/lib/safety/client";

type PortalPresence = DetailedPresence | AggregatePresence;

type PortalOfficeBaseProps = {
  channels: readonly OfficeChannel[];
  identityId: string;
  displayName: string;
  employeeRecord: ReactNode;
  eventChannelId: string;
  officeDay: string;
  isOperator: boolean;
  canSignOut: boolean;
};

type MockPortalOfficeProps = PortalOfficeBaseProps & {
  mode: "mock";
  publishableKey?: never;
};

type LivePortalOfficeProps = PortalOfficeBaseProps & {
  mode: "live";
  publishableKey: string;
};

type PortalChatProps = MockPortalOfficeProps | LivePortalOfficeProps;

type ReactionMutation = Pick<
  ReactionOfficeEvent,
  "officeChannelId" | "messageId" | "reaction" | "operation"
>;

type ReactionProps = {
  reactionEvents: readonly ReactionOfficeEvent[];
  reactionsEnabled: boolean;
  onReact(input: ReactionMutation): Promise<void>;
};

type OfficeDayWorkspace = Pick<
  PortalOfficeBaseProps,
  "channels" | "eventChannelId" | "officeDay"
>;

type ChatSurfaceProps = ReactionProps & {
  visible: boolean;
  readWhenVisible?: boolean;
  channel: OfficeChannel;
  identityId: string;
  messages: readonly unknown[];
  status: ChannelStatus;
  presence?: PortalPresence;
  onTyping(): void;
  onSend(text: string): Promise<void>;
  onRetryConnection(): void;
  loadPrevious?: () => Promise<unknown>;
  hasPrevious?: boolean;
  isLoadingPrevious?: boolean;
  onContentVisible?(): void;
};

type OfficeWorkspaceProps = Pick<
  PortalOfficeBaseProps,
  | "channels"
  | "identityId"
  | "displayName"
  | "employeeRecord"
  | "isOperator"
  | "canSignOut"
> & {
  activeChannelId: string;
  inboxRows: readonly OfficeInboxRow[];
  inboxStatus: InboxStatus;
  isMobile: boolean | null;
  mobileNavigationOpen: boolean;
  onOpenMobileNavigation(): void;
  onSelectChannel(channelId: string): void;
  children: ReactNode;
};

type MockHistoryPage = {
  messages: unknown[];
  hasPrevious: boolean;
};

type ProfileResolution = {
  status: "loading" | "ready" | "error";
  profiles: readonly ProfileAttribution[];
};

type LiveActivityProps = {
  active: boolean;
  channel: OfficeChannel;
  participantIds: readonly string[];
  presence?: PortalPresence;
  status: ChannelStatus;
};

type MockOfficeInbox = {
  entries: readonly OfficeInboxEntry[];
  status: InboxStatus;
  markAsRead(channelId: string): Promise<void>;
};

type ResponsiveOfficeNavigation = {
  isMobile: boolean | null;
  mobileNavigationOpen: boolean;
  conversationVisible: boolean;
  openMobileNavigation(): void;
  showConversation(): void;
};

const REACTION_NAMES: Record<OfficeReaction, string> = {
  "👍": "Thumbs up",
  "❤️": "Heart",
  "😂": "Laughing",
  "😮": "Surprised",
  "😢": "Sad",
  "🎉": "Celebrate",
};

const FALLBACK_PROFILE_NAME = "New Hire";
const LATEST_MESSAGE_THRESHOLD = 24;

function sendButtonCopy(isSending: boolean, hasError: boolean): string {
  if (isSending) {
    return "Sending…";
  }
  if (hasError) {
    return "Retry send";
  }
  return "Send";
}

function inboxStatusCopy(status: InboxStatus): string {
  switch (status) {
    case "ready":
      return "";
    case "reconnecting":
      return "Reconnecting…";
    case "idle":
    case "connecting":
      return "Connecting…";
  }
}

function useResponsiveOfficeNavigation(): ResponsiveOfficeNavigation {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(true);
  const openMobileNavigation = useCallback(
    () => setMobileNavigationOpen(true),
    [],
  );
  const showConversation = useCallback(
    () => setMobileNavigationOpen(false),
    [],
  );

  useEffect(() => {
    const query = window.matchMedia("(max-width: 850px)");
    const update = () => {
      setIsMobile(query.matches);
      if (query.matches) {
        setMobileNavigationOpen(true);
      }
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return {
    isMobile,
    mobileNavigationOpen,
    conversationVisible:
      isMobile === false || (isMobile === true && !mobileNavigationOpen),
    openMobileNavigation,
    showConversation,
  };
}

function getMessageId(message: unknown): string | undefined {
  if (
    typeof message !== "object" ||
    message === null ||
    !("id" in message) ||
    typeof message.id !== "string"
  ) {
    return undefined;
  }
  return message.id;
}

function replaceMessage(
  messages: readonly unknown[],
  id: string,
  replacement: unknown,
): unknown[] {
  return messages.map((message) =>
    getMessageId(message) === id ? replacement : message,
  );
}

function prependUniqueMessages(
  current: readonly unknown[],
  previous: readonly unknown[],
): unknown[] {
  const currentIds = new Set(
    current.map(getMessageId).filter((id): id is string => id !== undefined),
  );
  return [
    ...previous.filter((message) => {
      const id = getMessageId(message);
      return id === undefined || !currentIds.has(id);
    }),
    ...current,
  ];
}

function firstMessageId(messages: readonly unknown[]): string | undefined {
  return getMessageId(messages[0]);
}

function appendReactionEvent(
  events: ReactionOfficeEvent[],
  event: ReactionOfficeEvent,
): ReactionOfficeEvent[] {
  if (events.some(({ eventKey }) => eventKey === event.eventKey)) {
    return events;
  }
  return [...events, event];
}

function parseMockHistoryPage(value: unknown): MockHistoryPage | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("messages" in value) ||
    !Array.isArray(value.messages) ||
    !("hasPrevious" in value) ||
    typeof value.hasPrevious !== "boolean"
  ) {
    return null;
  }
  return {
    messages: value.messages,
    hasPrevious: value.hasPrevious,
  };
}

function useResolvedNewHireProfiles(
  profileIds: readonly string[],
  enabled: boolean,
): ProfileResolution {
  const query = useProfileBatch(enabled ? profileIds : []);
  const safetyStatus = useSafetyProjectionStatus(query);
  if (safetyStatus === "unavailable") {
    return { status: "error", profiles: [] };
  }
  if (safetyStatus === "loading") {
    return { status: "loading", profiles: [] };
  }
  return { status: "ready", profiles: query.data ?? [] };
}

function ParticipantList({
  channel,
  activeIds,
  participantIds,
  profilesById,
  resolutionStatus,
}: {
  channel: OfficeChannel;
  activeIds: ReadonlySet<string>;
  participantIds: readonly string[];
  profilesById: ReadonlyMap<string, ProfileAttribution>;
  resolutionStatus: ProfileResolution["status"];
}) {
  if (resolutionStatus === "loading") {
    return <span aria-live="polite">Loading New Hires…</span>;
  }

  if (resolutionStatus === "error") {
    return <span role="alert">New Hires are temporarily unavailable.</span>;
  }

  if (participantIds.length === 0) {
    return <span>No one is here yet.</span>;
  }

  const sortedParticipantIds = participantIds.toSorted((left, right) => {
    const activityDifference =
      Number(activeIds.has(right)) - Number(activeIds.has(left));
    if (activityDifference !== 0) return activityDifference;
    return profileDisplayName(profilesById.get(left)).localeCompare(
      profileDisplayName(profilesById.get(right)),
    );
  });

  return (
    <ul aria-label={`${channel.name} participants`}>
      {sortedParticipantIds.map((userId) => {
        const profile = profilesById.get(userId);
        const isActive = activeIds.has(userId);
        return (
          <li data-new-hire-id={userId} key={userId}>
            <a
              aria-label={`${profileDisplayName(profile)}, ${isActive ? "active" : "inactive"}. Open current New Hire Profile`}
              className="profile-context-trigger"
              href={`/office?profile=${encodeURIComponent(userId)}`}
            >
              <span
                aria-hidden="true"
                className="participant-activity-dot"
                data-active={isActive}
              />
              <span>
                <strong>{profileDisplayName(profile)}</strong>
                {profile?.status === "unavailable" ? (
                  <small>Profile unavailable</small>
                ) : null}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function LiveActivity({
  active,
  channel,
  participantIds,
  presence,
  status,
}: LiveActivityProps) {
  const detailedPresence =
    channel.mode === "standard" && presence?.kind === "detailed"
      ? presence
      : undefined;
  const presentIds = currentDetailedNewHireIds(detailedPresence, status);
  const profileIds = [...new Set([...presentIds, ...participantIds])];
  const resolution = useResolvedNewHireProfiles(
    profileIds,
    active && channel.mode === "standard",
  );
  const profilesById = new Map(
    resolution.profiles.map((profile) => [profile.clerkUserId, profile]),
  );

  if (channel.mode === "broadcast") {
    return (
      <aside className="live-activity-panel aggregate-presence">
        {presence?.kind === "aggregate" ? (
          <span>
            {presence.count.toLocaleString()} New Hire
            {presence.count === 1 ? "" : "s"} here
          </span>
        ) : (
          <span>Checking who&apos;s here…</span>
        )}
      </aside>
    );
  }

  return (
    <aside className="live-activity-panel detailed-presence">
      <strong className="participants-heading">Participants</strong>
      <ParticipantList
        activeIds={new Set(presentIds)}
        channel={channel}
        participantIds={profileIds}
        profilesById={profilesById}
        resolutionStatus={resolution.status}
      />
    </aside>
  );
}

async function fetchMockHistoryPage(
  channelSlug: OfficeChannel["slug"],
  before?: string,
): Promise<MockHistoryPage> {
  const searchParams = new URLSearchParams({ channel: channelSlug });
  if (before) {
    searchParams.set("before", before);
  }

  const response = await fetch(
    `/api/office/portal/mock-chat?${searchParams.toString()}`,
    { credentials: "include", cache: "no-store" },
  );
  const payload: unknown = await response.json().catch(() => null);
  const historyPage = parseMockHistoryPage(payload);
  if (!response.ok || !historyPage) {
    throw new Error("Mock Portal history unavailable");
  }
  return historyPage;
}

function useMockOfficeInbox(): MockOfficeInbox {
  const [entries, setEntries] = useState<readonly OfficeInboxEntry[]>([]);
  const [status, setStatus] = useState<InboxStatus>("connecting");
  const requestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) {
      return;
    }
    requestInFlight.current = true;
    try {
      const response = await fetch("/api/office/portal/mock-inbox", {
        credentials: "include",
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      const snapshot = parseOfficeInboxSnapshot(payload);
      if (!response.ok || !snapshot) {
        throw new Error("Mock Portal inbox unavailable");
      }
      setEntries(snapshot.entries);
      setStatus("ready");
    } catch {
      setStatus("reconnecting");
    } finally {
      requestInFlight.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 300);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const markAsRead = useCallback(
    async (channelId: string) => {
      const response = await fetch("/api/office/portal/mock-inbox", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId }),
      });
      if (!response.ok) {
        setStatus("reconnecting");
        return;
      }
      await refresh();
    },
    [refresh],
  );

  return {
    entries,
    status,
    markAsRead,
  };
}

async function fetchMockOfficeEvents(
  eventChannelId: string,
): Promise<OfficeEvent[]> {
  const response = await fetch("/api/office/portal/mock-events", {
    credentials: "include",
    cache: "no-store",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload)) {
    throw new Error("Mock Portal Office Event history unavailable");
  }
  return payload.flatMap((message) => {
    const parsed = parseOfficeEventMessage(message, eventChannelId);
    return parsed ? [parsed.event] : [];
  });
}

function SafeMessageText({ text }: { text: string }) {
  let characterOffset = 0;
  return linkifyChatText(text).map((part) => {
    const key = `${part.kind}-${characterOffset}-${part.value}`;
    characterOffset += part.value.length;
    return part.kind === "link" ? (
      <a href={part.value} key={key} rel="noopener noreferrer" target="_blank">
        {part.value}
      </a>
    ) : (
      <span key={key}>{part.value}</span>
    );
  });
}

function ReactionControls({
  message,
  reactions,
  identityId,
  enabled,
  onReact,
}: {
  message: SafePortalChatMessage;
  reactions: readonly ProjectedOfficeReaction[];
  identityId: string;
  enabled: boolean;
  onReact(input: ReactionMutation): Promise<void>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstReactionRef = useRef<HTMLButtonElement>(null);
  const pickerId = `reaction-picker-${message.id}`;

  useEffect(() => {
    if (pickerOpen) {
      firstReactionRef.current?.focus();
    }
  }, [pickerOpen]);

  function operationFor(reaction: OfficeReaction): "add" | "remove" {
    return reactions
      .find((entry) => entry.reaction === reaction)
      ?.actorIds.includes(identityId)
      ? "remove"
      : "add";
  }

  async function updateReaction(reaction: OfficeReaction): Promise<void> {
    setError(null);
    setIsUpdating(true);
    let saved = false;
    try {
      await onReact({
        officeChannelId: message.channelId,
        messageId: message.id,
        reaction,
        operation: operationFor(reaction),
      });
      setPickerOpen(false);
      saved = true;
    } catch {
      setError("Reaction not saved. Choose it again to retry.");
    } finally {
      setIsUpdating(false);
      if (saved) {
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
  }

  function handlePickerKeyDown(
    event: KeyboardEvent<HTMLFieldSetElement>,
  ): void {
    if (event.key === "Escape") {
      event.preventDefault();
      setPickerOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div className="reaction-controls">
      <fieldset className="reaction-summary">
        <legend className="sr-only">Message reactions</legend>
        {reactions.map(({ reaction, actorIds }) => {
          const ownReaction = actorIds.includes(identityId);
          return (
            <button
              aria-label={`${REACTION_NAMES[reaction]}: ${actorIds.length} reaction${actorIds.length === 1 ? "" : "s"}. ${ownReaction ? "Remove your reaction" : "Add your reaction"}.`}
              aria-pressed={ownReaction}
              className="reaction-count-button"
              disabled={!enabled || isUpdating}
              key={reaction}
              onClick={() => void updateReaction(reaction)}
              type="button"
            >
              <span aria-hidden="true">{reaction}</span>
              <span>{actorIds.length}</span>
            </button>
          );
        })}
      </fieldset>
      <button
        aria-controls={pickerId}
        aria-expanded={pickerOpen}
        className="reaction-picker-trigger"
        disabled={!enabled || isUpdating}
        onClick={() => setPickerOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">+</span>
        <span className="sr-only">Add or remove a reaction</span>
      </button>
      {pickerOpen ? (
        <fieldset
          className="reaction-picker"
          id={pickerId}
          onKeyDown={handlePickerKeyDown}
        >
          <legend className="sr-only">Choose a reaction</legend>
          {OFFICE_REACTIONS.map((reaction, index) => {
            const operation = operationFor(reaction);
            return (
              <button
                aria-label={`${REACTION_NAMES[reaction]} (${reaction}), ${operation} reaction`}
                aria-pressed={operation === "remove"}
                disabled={isUpdating}
                key={reaction}
                onClick={() => void updateReaction(reaction)}
                ref={index === 0 ? firstReactionRef : undefined}
                type="button"
              >
                <span aria-hidden="true">{reaction}</span>
              </button>
            );
          })}
        </fieldset>
      ) : null}
      {isUpdating ? <span className="sr-only">Saving reaction</span> : null}
      {error ? (
        <small className="reaction-error" role="alert">
          {error}
        </small>
      ) : null}
    </div>
  );
}

function profileDisplayName(profile: ProfileAttribution | undefined): string {
  return profile?.displayName ?? FALLBACK_PROFILE_NAME;
}

function ProfileAvatar({
  profile,
  size,
  imageClassName,
  placeholderClassName,
}: {
  profile: ProfileAttribution | undefined;
  size: number;
  imageClassName?: string;
  placeholderClassName: string;
}) {
  if (profile?.imageUrl) {
    return (
      <Image
        alt=""
        className={imageClassName}
        height={size}
        src={profile.imageUrl}
        unoptimized
        width={size}
      />
    );
  }

  return (
    <span aria-hidden="true" className={placeholderClassName}>
      {profileDisplayName(profile).slice(0, 1)}
    </span>
  );
}

function ScriptedSystemEventListItem({
  message,
}: {
  message: SafeScriptedSystemEventMessage;
}) {
  return (
    <li
      className="chat-message system-event-message"
      data-event-key={message.eventKey}
      data-message-id={message.id}
    >
      <div className="message-meta system-event-meta">
        <span aria-hidden="true" className="system-event-icon">
          !
        </span>
        <strong>{message.character.name}</strong>
        <span className="office-character-badge">
          Office Character · Fictional
        </span>
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {formatOfficeTimestamp(message.timestamp)}
        </time>
      </div>
      <small>{message.character.role}</small>
      <p>
        <SafeMessageText text={message.content.text} />
      </p>
    </li>
  );
}

function SendHomeSystemEventListItem({
  message,
  profilesById,
}: {
  message: SafePublicSendHomeSystemEventMessage;
  profilesById: ReadonlyMap<string, ProfileAttribution>;
}) {
  const operatorName = profileDisplayName(profilesById.get(message.operatorId));
  const targetName = profileDisplayName(
    profilesById.get(message.targetNewHireId),
  );

  return (
    <li
      className="chat-message system-event-message"
      data-event-key={message.eventKey}
      data-message-id={message.id}
    >
      <div className="message-meta system-event-meta">
        <span aria-hidden="true" className="system-event-icon">
          !
        </span>
        <strong>Portal Systems Operations</strong>
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {formatOfficeTimestamp(message.timestamp)}
        </time>
      </div>
      <p>
        {operatorName} sent {targetName} home for the rest of this Office Day.
      </p>
    </li>
  );
}

function TerminationSystemEventListItem({
  message,
  profilesById,
}: {
  message: SafePublicTerminationSystemEventMessage;
  profilesById: ReadonlyMap<string, ProfileAttribution>;
}) {
  const operatorName = profileDisplayName(profilesById.get(message.operatorId));
  const targetName = profileDisplayName(
    profilesById.get(message.targetNewHireId),
  );

  return (
    <li
      className="chat-message system-event-message"
      data-event-key={message.eventKey}
      data-message-id={message.id}
    >
      <div className="message-meta system-event-meta">
        <span aria-hidden="true" className="system-event-icon">
          !
        </span>
        <strong>Portal Systems Operations</strong>
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {formatOfficeTimestamp(message.timestamp)}
        </time>
      </div>
      <p>
        {operatorName}{" "}
        {message.action === "terminated" ? "terminated" : "reinstated"}{" "}
        {targetName}.
      </p>
    </li>
  );
}

function MessageHistory({
  channel,
  messages,
  identityId,
  reactionEvents,
  reactionsEnabled,
  onReact,
  profilesById,
  removedMessageIds,
}: ReactionProps & {
  channel: OfficeChannel;
  messages: readonly SafeOfficeChannelMessage[];
  identityId: string;
  profilesById: ReadonlyMap<string, ProfileAttribution>;
  removedMessageIds: ReadonlySet<string>;
}) {
  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <strong>No messages yet.</strong>
      </div>
    );
  }

  const visibleMessageIds = new Set(
    messages
      .filter(isNewHireMessage)
      .filter(({ status }) => status === "sent")
      .filter(({ id }) => !removedMessageIds.has(id))
      .map(({ id }) => id),
  );
  const projection = createReactionProjection({
    isValidTarget: (officeChannelId, messageId) =>
      officeChannelId === channel.id && visibleMessageIds.has(messageId),
  });
  for (const event of reactionEvents) {
    projection.apply(event);
  }

  return (
    <ol
      className="message-history"
      aria-label={`${channel.name} message history`}
    >
      {messages.map((message) => {
        if (removedMessageIds.has(message.id)) {
          return (
            <li
              className="chat-message removed-message"
              data-message-id={message.id}
              key={message.id}
              tabIndex={-1}
            >
              <div className="message-meta removed-message-meta">
                <strong>Removed Message</strong>
                <time dateTime={new Date(message.timestamp).toISOString()}>
                  {formatOfficeTimestamp(message.timestamp)}
                </time>
              </div>
              <p>
                An Operator removed this message from Portal Messenger. Its
                place in the conversation is preserved.
              </p>
            </li>
          );
        }
        if (isPublicTerminationSystemEventMessage(message)) {
          return (
            <TerminationSystemEventListItem
              key={message.id}
              message={message}
              profilesById={profilesById}
            />
          );
        }
        if (isPublicSendHomeSystemEventMessage(message)) {
          return (
            <SendHomeSystemEventListItem
              key={message.id}
              message={message}
              profilesById={profilesById}
            />
          );
        }
        if (isScriptedSystemEventMessage(message)) {
          return (
            <ScriptedSystemEventListItem key={message.id} message={message} />
          );
        }
        const profile = profilesById.get(message.senderId);
        return (
          <li
            className={`chat-message chat-message-${message.status}`}
            data-message-id={message.id}
            key={message.id}
            tabIndex={-1}
          >
            <div className="message-meta">
              <a
                aria-label={`Open current New Hire Profile for ${profileDisplayName(profile)}`}
                className="profile-context-trigger"
                href={`/office?profile=${encodeURIComponent(message.senderId)}`}
              >
                <ProfileAvatar
                  imageClassName="message-avatar"
                  placeholderClassName="message-avatar-placeholder"
                  profile={profile}
                  size={28}
                />
                <strong>{profileDisplayName(profile)}</strong>
              </a>
              <time dateTime={new Date(message.timestamp).toISOString()}>
                {formatOfficeTimestamp(message.timestamp)}
              </time>
            </div>
            <p>
              <SafeMessageText text={message.content.text} />
            </p>
            {message.status === "pending" ? <small>Sending…</small> : null}
            {message.status === "failed" ? (
              <small role="alert">
                Not delivered. Retry from the composer.
              </small>
            ) : null}
            {message.status === "sent" ? (
              <div className="message-actions">
                <ReactionControls
                  enabled={reactionsEnabled}
                  identityId={identityId}
                  message={message}
                  onReact={onReact}
                  reactions={projection.read(channel.id, message.id)}
                />
                <MessageHRReportControls message={message} />
                <MessageRemovalControls message={message} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function isChatContentReady(status: ChannelStatus): boolean {
  return (
    status === "ready" || status === "degraded" || status === "degraded-http"
  );
}

function hasRenderedLatestMessage(
  surface: HTMLElement,
  messageCount: number,
  latestMessageId: string | null,
): boolean {
  const renderedLatestMessageId =
    surface
      .querySelector(".message-history")
      ?.lastElementChild?.getAttribute("data-message-id") ?? null;

  return (
    surface.querySelectorAll(".chat-message").length === messageCount &&
    renderedLatestMessageId === latestMessageId
  );
}

function isElementInViewport(element: HTMLElement): boolean {
  const bounds = element.getBoundingClientRect();
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    bounds.bottom > 0 &&
    bounds.right > 0 &&
    bounds.top < window.innerHeight &&
    bounds.left < window.innerWidth
  );
}

function ChatSurface({
  visible,
  readWhenVisible = true,
  channel,
  identityId,
  messages: rawMessages,
  status,
  presence,
  onTyping,
  reactionEvents,
  reactionsEnabled,
  onReact,
  onSend,
  onRetryConnection,
  loadPrevious,
  hasPrevious = false,
  isLoadingPrevious = false,
  onContentVisible,
}: ChatSurfaceProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const followingLatestMessage = useRef(true);
  const surfaceRef = useRef<HTMLElement>(null);
  const latestOnContentVisible = useRef(onContentVisible);
  const parsedMessages = useMemo(
    () => parseOfficeChannelMessages(rawMessages, channel.id),
    [channel.id, rawMessages],
  );
  const messages = parsedMessages.messages;
  const latestMessageId = messages.at(-1)?.id ?? null;
  const removalQuery = useMessageRemovals(channel.id);
  const removalSafetyStatus = useSafetyProjectionStatus(removalQuery);
  const removedMessageIds = useMemo(
    () => new Set((removalQuery.data ?? []).map(({ messageId }) => messageId)),
    [removalQuery.data],
  );
  const participantIds = useMemo(
    () => [
      ...new Set([
        identityId,
        ...messages.filter(isNewHireMessage).map(({ senderId }) => senderId),
      ]),
    ],
    [identityId, messages],
  );
  const profileIds = useMemo(
    () =>
      messages
        .filter(isNewHireMessage)
        .filter(({ id }) => !removedMessageIds.has(id))
        .map(({ senderId }) => senderId),
    [messages, removedMessageIds],
  );
  const profileQuery = useProfileBatch(profileIds);
  const profileSafetyStatus = useSafetyProjectionStatus(profileQuery);
  const messageHistoryReady =
    removalSafetyStatus === "ready" && profileSafetyStatus === "ready";
  const profilesById = useMemo(
    () =>
      new Map(
        (profileQuery.data ?? []).map((profile) => [
          profile.clerkUserId,
          profile,
        ]),
      ),
    [profileQuery.data],
  );
  let messageHistory: ReactNode;
  if (
    removalSafetyStatus === "unavailable" ||
    profileSafetyStatus === "unavailable"
  ) {
    messageHistory = (
      <div className="safety-outage" role="alert">
        <strong>Message safety checks are unavailable.</strong>
        <span className="outage-detail">
          No conversation content is shown until New Hire Profiles and Removed
          Messages can be verified.
        </span>
      </div>
    );
  } else if (!messageHistoryReady) {
    messageHistory = (
      <p className="profile-status">Verifying message safety…</p>
    );
  } else {
    messageHistory = (
      <MessageHistory
        channel={channel}
        identityId={identityId}
        messages={messages}
        onReact={onReact}
        profilesById={profilesById}
        reactionEvents={reactionEvents}
        reactionsEnabled={reactionsEnabled}
        removedMessageIds={removedMessageIds}
      />
    );
  }

  useEffect(() => {
    latestOnContentVisible.current = onContentVisible;
  }, [onContentVisible]);

  useEffect(() => {
    if (
      !visible ||
      !messageHistoryReady ||
      !isChatContentReady(status) ||
      messages.length === 0 ||
      !latestMessageId
    ) {
      return;
    }
    const target = parseHRReportReviewTarget(window.location.search);
    if (
      !target ||
      target.subjectType !== "message" ||
      target.officeChannelId !== channel.id
    )
      return;
    const element = [
      ...document.querySelectorAll<HTMLElement>(".chat-message"),
    ].find(
      (candidate) =>
        candidate.getAttribute("data-message-id") === target.messageId,
    );
    if (!element) return;
    followingLatestMessage.current = false;
    element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: true });
  }, [
    channel.id,
    latestMessageId,
    messages.length,
    messageHistoryReady,
    status,
    visible,
  ]);

  useEffect(() => {
    if (
      !visible ||
      !messageHistoryReady ||
      !isChatContentReady(status) ||
      !latestMessageId ||
      !followingLatestMessage.current
    ) {
      return;
    }

    const region = scrollRegionRef.current;
    if (region) {
      region.scrollTop = region.scrollHeight;
    }
  }, [latestMessageId, messageHistoryReady, status, visible]);

  useEffect(() => {
    if (
      !visible ||
      !readWhenVisible ||
      !messageHistoryReady ||
      !isChatContentReady(status)
    ) {
      return;
    }

    const surface = surfaceRef.current;
    if (!surface) return;
    let animationFrame = 0;
    const reportIfVisible = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (
          !document.hidden &&
          !surface.hidden &&
          hasRenderedLatestMessage(surface, messages.length, latestMessageId) &&
          isElementInViewport(surface)
        ) {
          latestOnContentVisible.current?.();
        }
      });
    };
    const observer = new IntersectionObserver(reportIfVisible, {
      threshold: 0.01,
    });
    observer.observe(surface);
    document.addEventListener("visibilitychange", reportIfVisible);
    window.addEventListener("resize", reportIfVisible);
    reportIfVisible();
    return () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", reportIfVisible);
      window.removeEventListener("resize", reportIfVisible);
    };
  }, [
    latestMessageId,
    messages.length,
    messageHistoryReady,
    readWhenVisible,
    status,
    visible,
  ]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError(null);
    let content: PortalChatContent;
    try {
      content = validateChatDraft(draft);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Invalid message.");
      return;
    }

    setDraft("");
    setIsSending(true);
    try {
      await onSend(content.text);
    } catch {
      setDraft(content.text);
      setSendError("Message not delivered. Your text is ready to retry.");
    } finally {
      setIsSending(false);
    }
  }

  async function loadEarlier() {
    if (!loadPrevious) return;
    const region = scrollRegionRef.current;
    const previousHeight = region?.scrollHeight ?? 0;
    const previousTop = region?.scrollTop ?? 0;
    await loadPrevious();
    if (!region) return;
    let remainingFrames = 60;
    const restoreScrollPosition = () => {
      const nextHeight = region.scrollHeight;
      if (nextHeight <= previousHeight) {
        if (remainingFrames > 0) {
          remainingFrames -= 1;
          requestAnimationFrame(restoreScrollPosition);
        }
        return;
      }
      region.scrollTop = previousTop + nextHeight - previousHeight;
    };
    requestAnimationFrame(restoreScrollPosition);
  }

  const canPublish = isChatContentReady(status) && messageHistoryReady;
  const headingId = `office-channel-heading-${channel.slug}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`general-chat ${channel.mode === "broadcast" ? "broadcast-chat" : ""}`}
      hidden={!visible}
      id={`office-channel-${channel.slug}`}
      ref={surfaceRef}
    >
      <header className="conversation-heading">
        <div>
          <span
            className={`presence-dot connection-${status}`}
            aria-hidden="true"
          />
          <strong id={headingId}># {channel.slug}</strong>
          <span className="channel-purpose">{channel.purpose}</span>
        </div>
        {status === "ready" ? null : (
          <output className="connection-status" aria-live="polite">
            {connectionStatusCopy(status)}
          </output>
        )}
      </header>

      <div className="conversation-content">
        <LiveActivity
          active={visible}
          channel={channel}
          participantIds={participantIds}
          presence={presence}
          status={status}
        />
        <div
          className="chat-scroll-region"
          onScroll={(event) => {
            if (!visible || !messageHistoryReady || !isChatContentReady(status))
              return;
            const region = event.currentTarget;
            followingLatestMessage.current =
              region.scrollHeight - region.scrollTop - region.clientHeight <=
              LATEST_MESSAGE_THRESHOLD;
          }}
          ref={scrollRegionRef}
        >
          {hasPrevious && loadPrevious ? (
            <Button
              className="load-history-button"
              disabled={isLoadingPrevious}
              onClick={() => void loadEarlier()}
              type="button"
            >
              {isLoadingPrevious ? "Loading…" : "Load earlier messages"}
            </Button>
          ) : null}
          {status === "blocked" || status === "reconnecting" ? (
            <div className="portal-outage" aria-live="polite">
              <strong>Connection lost. Portal is offline.</strong>
              <span className="outage-detail">
                Live conversation service is temporarily unavailable.
              </span>
              <Button onClick={onRetryConnection} type="button">
                Retry
              </Button>
            </div>
          ) : null}
          {messageHistory}
        </div>
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor={`message-${channel.id}`}>
          Message # {channel.name}
        </label>
        <Textarea
          disabled={!canPublish}
          id={`message-${channel.id}`}
          maxLength={CHAT_TEXT_LIMIT}
          onChange={(event) => {
            const nextDraft = event.target.value;
            setDraft(nextDraft);
            if (
              visible &&
              canPublish &&
              channel.mode === "standard" &&
              nextDraft.trim().length > 0
            ) {
              onTyping();
            }
          }}
          placeholder={canPublish ? "Type a message…" : "Reconnecting…"}
          rows={3}
          value={draft}
        />
        <div className="composer-actions">
          <span className="character-count">
            {draft.length.toLocaleString()} / 1,000
          </span>
          <Button
            className="send-message-button"
            disabled={!canPublish || isSending || draft.trim().length === 0}
            type="submit"
          >
            {sendButtonCopy(isSending, sendError !== null)}
          </Button>
        </div>
        {sendError ? (
          <p className="chat-error" role="alert">
            {sendError}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function OfficeWorkspace({
  channels,
  identityId,
  displayName,
  employeeRecord,
  isOperator,
  canSignOut,
  activeChannelId,
  inboxRows,
  inboxStatus,
  isMobile,
  mobileNavigationOpen,
  onOpenMobileNavigation,
  onSelectChannel,
  children,
}: OfficeWorkspaceProps) {
  const currentProfile = useProfileBatch([identityId]);
  const currentProfileSafety = useSafetyProjectionStatus(currentProfile);
  const operatorState = useOperatorState(isOperator);
  const hasOperatorAccess =
    !operatorState.isError && operatorState.data?.isOperator === true;
  const currentDisplayName =
    currentProfileSafety === "ready"
      ? (currentProfile.data?.find(
          (profile) => profile.clerkUserId === identityId,
        )?.displayName ?? displayName)
      : FALLBACK_PROFILE_NAME;
  const directoryButtons = useRef(new Map<string, HTMLButtonElement>());
  const mobileDirectoryTrigger = useRef<HTMLButtonElement>(null);
  const inboxRowsByChannelId = new Map(
    inboxRows.map((row) => [row.channelId, row]),
  );
  useEffect(() => {
    if (isMobile !== true) return;
    if (mobileNavigationOpen) {
      directoryButtons.current.get(activeChannelId)?.focus();
    } else {
      mobileDirectoryTrigger.current?.focus();
    }
  }, [activeChannelId, isMobile, mobileNavigationOpen]);

  return (
    <OperatorAccessContext.Provider value={hasOperatorAccess}>
      <div
        className="office-body"
        data-mobile-view={mobileNavigationOpen ? "directory" : "conversation"}
      >
        <aside className="channel-panel" aria-label="Office Channels">
          <p className="eyebrow">Shared Public Office</p>
          <h1>Welcome, {currentDisplayName}</h1>
          {inboxStatus === "ready" ? null : (
            <output className="inbox-status" aria-live="polite">
              {inboxStatusCopy(inboxStatus)}
            </output>
          )}
          <nav aria-label="Office Channel directory">
            {channels.map((channel) => {
              const row = inboxRowsByChannelId.get(channel.id);
              const unreadCount = row?.unread ?? 0;
              return (
                <button
                  aria-controls={`office-channel-${channel.slug}`}
                  aria-current={
                    channel.id === activeChannelId ? "page" : undefined
                  }
                  className="channel-button"
                  key={channel.id}
                  onClick={() => onSelectChannel(channel.id)}
                  ref={(element) => {
                    if (element) {
                      directoryButtons.current.set(channel.id, element);
                    } else {
                      directoryButtons.current.delete(channel.id);
                    }
                  }}
                  type="button"
                >
                  <span className="channel-button-copy">
                    <strong># {channel.slug}</strong>
                    <small className="channel-preview">
                      {row?.preview
                        ? "New conversation activity"
                        : "No messages yet"}
                    </small>
                  </span>
                  {unreadCount > 0 ? (
                    <b>
                      <span className="sr-only">{unreadCount} unread</span>
                      <span aria-hidden="true">{unreadCount}</span>
                    </b>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <HRReportReviewQueue enabled={hasOperatorAccess} />
          {employeeRecord}
          {canSignOut ? (
            <form action="/api/auth/sign-out" method="post">
              <Button className="sign-out-button" type="submit">
                Sign out
              </Button>
            </form>
          ) : null}
        </aside>
        <section className="conversation-panel">
          <button
            aria-label="Open Office Channel directory"
            className="mobile-directory-trigger"
            onClick={onOpenMobileNavigation}
            ref={mobileDirectoryTrigger}
            type="button"
          >
            ‹ Office Channels
          </button>
          {children}
        </section>
      </div>
      <NewHireProfileContext canSendHome={hasOperatorAccess} />
    </OperatorAccessContext.Provider>
  );
}

function LiveOfficeChannel({
  visible,
  channel: officeChannel,
  identityId,
  onInboxRead,
  onReact,
  reactionEvents,
  reactionsEnabled,
}: ReactionProps & {
  visible: boolean;
  channel: OfficeChannel;
  identityId: string;
  onInboxRead(channelId: string): void;
}) {
  const channel = useChannel<{ text: string }>({
    channelId: officeChannel.id,
    history: 50,
    readOn: "manual",
  });
  const markVisibleContentRead = useCallback(() => {
    channel.markAsRead();
    onInboxRead(officeChannel.id);
  }, [channel.markAsRead, officeChannel.id, onInboxRead]);

  return (
    <ChatSurface
      channel={officeChannel}
      hasPrevious={channel.hasPrevious}
      identityId={identityId}
      isLoadingPrevious={channel.isLoadingPrevious}
      loadPrevious={channel.loadPrevious}
      messages={channel.messages}
      onTyping={channel.sendTyping}
      onReact={onReact}
      onRetryConnection={() => window.location.reload()}
      onContentVisible={markVisibleContentRead}
      onSend={async (text) => {
        await channel.send({ content: validateChatDraft(text) });
      }}
      reactionEvents={reactionEvents}
      reactionsEnabled={reactionsEnabled}
      status={channel.status}
      presence={channel.presence}
      visible={visible}
    />
  );
}

function useReactionPublisher({
  identityId,
  eventChannelId,
  publish,
}: {
  identityId: string;
  eventChannelId: string;
  publish(event: ReactionOfficeEvent): Promise<void>;
}): (input: ReactionMutation) => Promise<void> {
  const lastTimestamp = useRef(0);
  const retryEvents = useRef(new Map<string, ReactionOfficeEvent>());

  return useCallback(
    async (input: ReactionMutation) => {
      const retryPrefix = [
        input.officeChannelId,
        input.messageId,
        input.reaction,
      ].join("\u0000");
      const retryKey = `${retryPrefix}\u0000${input.operation}`;
      const oppositeOperation = input.operation === "add" ? "remove" : "add";
      retryEvents.current.delete(`${retryPrefix}\u0000${oppositeOperation}`);
      let event = retryEvents.current.get(retryKey);
      if (!event) {
        const timestamp = Math.max(Date.now(), lastTimestamp.current + 1);
        lastTimestamp.current = timestamp;
        event = createReactionOfficeEvent({
          ...input,
          mutationId: crypto.randomUUID(),
          occurredAt: new Date(timestamp).toISOString(),
          officeDay: eventChannelId.split(":")[1] ?? "",
          actorId: identityId,
        });
        retryEvents.current.set(retryKey, event);
      }
      await publish(event);
      retryEvents.current.delete(retryKey);
    },
    [eventChannelId, identityId, publish],
  );
}

function useActiveOfficeChannel(
  channels: readonly OfficeChannel[],
  currentOfficeDay: string,
) {
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");

  useEffect(() => {
    const target = parseHRReportReviewTarget(window.location.search);
    if (
      !target ||
      target.subjectType !== "message" ||
      target.officeDay !== currentOfficeDay
    ) {
      return;
    }
    const targetsKnownChannel = channels.some(
      ({ id }) => id === target.officeChannelId,
    );
    if (!targetsKnownChannel) return;

    setActiveChannelId(target.officeChannelId);
  }, [channels, currentOfficeDay]);

  return { activeChannelId, setActiveChannelId };
}

function recheckEmploymentAccess(
  onEmploymentAccessEnded: (access: EmploymentAccessDeniedDecision) => void,
  onError: () => void,
): void {
  void fetchEmploymentAccess()
    .then((access) => {
      if (!access.eligible) {
        onEmploymentAccessEnded(access);
      }
    })
    .catch(onError);
}

function ignoreMockEmploymentAccessError(): void {}

function LivePortalWorkspace({
  channels,
  identityId,
  displayName,
  employeeRecord,
  eventChannelId,
  officeDay: currentOfficeDay,
  isOperator,
  canSignOut,
  onEmploymentAccessEnded,
}: Omit<LivePortalOfficeProps, "mode" | "publishableKey"> & {
  onEmploymentAccessEnded(access: EmploymentAccessDeniedDecision): void;
}) {
  const queryClient = useQueryClient();
  const [reactionEvents, setReactionEvents] = useState<ReactionOfficeEvent[]>(
    [],
  );
  const handleInvalidation = useCallback(
    (event: OfficeInvalidationEvent) => {
      switch (event.type) {
        case "profile.invalidated":
          void invalidateProfileBatches(queryClient, event.profileId);
          if (event.profileId === identityId) {
            recheckEmploymentAccess(onEmploymentAccessEnded, () =>
              window.location.reload(),
            );
          }
          break;
        case "report.invalidated":
          void invalidateHRReportQueue(queryClient);
          break;
        case "message-removal.invalidated":
          void invalidateMessageRemovals(queryClient);
          break;
        case "employment.invalidated":
          if (event.newHireId === identityId) {
            recheckEmploymentAccess(onEmploymentAccessEnded, () =>
              window.location.reload(),
            );
          }
          break;
        case "operator.invalidated":
          if (event.operatorId === identityId) {
            void invalidateOperatorState(queryClient);
          }
          break;
      }
    },
    [identityId, onEmploymentAccessEnded, queryClient],
  );
  const { status: eventStatus, publishReaction } = useOfficeEventSubscription({
    channelId: eventChannelId,
    onReaction: (event) => {
      setReactionEvents((current) => appendReactionEvent(current, event));
    },
    onInvalidation: handleInvalidation,
  });
  const { activeChannelId, setActiveChannelId } = useActiveOfficeChannel(
    channels,
    currentOfficeDay,
  );
  const navigation = useResponsiveOfficeNavigation();
  const inbox = useInbox();
  const inboxRows = useMemo(
    () =>
      reconcileOfficeInbox({
        channels,
        entries: inbox.channels,
        identityId,
        displayName,
      }),
    [channels, displayName, identityId, inbox.channels],
  );
  const markInboxRead = useCallback(
    (channelId: string) => {
      const entry = inbox.channels.get(channelId);
      if (entry && entry.unread > 0) {
        entry.markAsRead();
      }
    },
    [inbox.channels],
  );
  const selectChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      navigation.showConversation();
    },
    [navigation.showConversation, setActiveChannelId],
  );
  const updateReaction = useReactionPublisher({
    identityId,
    eventChannelId,
    publish: publishReaction,
  });
  const reactionsEnabled =
    eventStatus === "ready" ||
    eventStatus === "degraded" ||
    eventStatus === "degraded-http";

  return (
    <OfficeWorkspace
      activeChannelId={activeChannelId}
      canSignOut={canSignOut}
      channels={channels}
      displayName={displayName}
      employeeRecord={employeeRecord}
      identityId={identityId}
      inboxRows={inboxRows}
      inboxStatus={inbox.status}
      isMobile={navigation.isMobile}
      isOperator={isOperator}
      mobileNavigationOpen={navigation.mobileNavigationOpen}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
    >
      {channels.map((channel) => (
        <LiveOfficeChannel
          channel={channel}
          identityId={identityId}
          key={channel.id}
          onInboxRead={markInboxRead}
          onReact={updateReaction}
          reactionEvents={reactionEvents}
          reactionsEnabled={reactionsEnabled}
          visible={
            navigation.conversationVisible && channel.id === activeChannelId
          }
        />
      ))}
    </OfficeWorkspace>
  );
}

function LivePortalOffice(
  props: Omit<LivePortalOfficeProps, "mode"> & {
    onOfficeDayExpired(): void;
    onEmploymentAccessEnded(access: EmploymentAccessDeniedDecision): void;
  },
) {
  const { getToken } = useAuth();
  const {
    officeDay: currentOfficeDay,
    publishableKey,
    onOfficeDayExpired,
  } = props;
  const [portal] = useState(
    () =>
      new Portal({
        apiKey: publishableKey,
        token: createPortalTokenSource({
          expectedOfficeDay: currentOfficeDay,
          getAuthorizationToken: getToken,
          onOfficeDayExpired,
        }),
      }),
  );

  return (
    <PortalProvider client={portal}>
      <LivePortalWorkspace {...props} />
    </PortalProvider>
  );
}

function MockOfficeChannel({
  visible,
  channel,
  identityId,
  latestActivityAt,
  onContentVisible,
  onReact,
  reactionEvents,
  reactionsEnabled,
  officeDay: currentOfficeDay,
  onOfficeDayExpired,
}: ReactionProps & {
  visible: boolean;
  channel: OfficeChannel;
  identityId: string;
  latestActivityAt: number;
  onContentVisible(channelId: string): void;
  officeDay: string;
  onOfficeDayExpired(): void;
}) {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [status, setStatus] = useState<ChannelStatus>("connecting");
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [readWhenVisible, setReadWhenVisible] = useState(false);

  const loadMockHistory = useCallback(async (): Promise<boolean> => {
    setStatus("connecting");
    try {
      await createPortalTokenSource({
        expectedOfficeDay: currentOfficeDay,
        onOfficeDayExpired,
      })();
      const historyPage = await fetchMockHistoryPage(channel.slug);
      setMessages(historyPage.messages);
      setHasPrevious(historyPage.hasPrevious);
      setStatus("ready");
      return true;
    } catch {
      setMessages([]);
      setHasPrevious(false);
      setStatus("reconnecting");
      return false;
    }
  }, [channel.slug, currentOfficeDay, onOfficeDayExpired]);

  useEffect(() => {
    if (!visible) {
      setReadWhenVisible(false);
      return;
    }
    let current = true;
    const expectedActivityAt = latestActivityAt;
    setReadWhenVisible(false);
    void loadMockHistory().then((loaded) => {
      if (current && loaded && expectedActivityAt === latestActivityAt) {
        setReadWhenVisible(true);
      }
    });
    return () => {
      current = false;
    };
  }, [latestActivityAt, loadMockHistory, visible]);

  async function loadPrevious(): Promise<void> {
    const before = firstMessageId(messages);
    if (!before) return;
    setIsLoadingPrevious(true);
    try {
      const historyPage = await fetchMockHistoryPage(channel.slug, before);
      setMessages((current) =>
        prependUniqueMessages(current, historyPage.messages),
      );
      setHasPrevious(historyPage.hasPrevious);
    } finally {
      setIsLoadingPrevious(false);
    }
  }

  async function sendMessage(text: string): Promise<void> {
    const content = validateChatDraft(text);
    const temporaryId = `pending-${crypto.randomUUID()}`;
    const pendingMessage = {
      id: temporaryId,
      channelId: channel.id,
      sender: { id: identityId, anon: false },
      timestamp: Date.now(),
      kind: "text",
      type: "message",
      ephemeral: false,
      retracted: false,
      status: "pending",
      content,
    };
    setMessages((current) => [...current, pendingMessage]);

    try {
      const response = await fetch(
        `/api/office/portal/mock-chat?channel=${encodeURIComponent(channel.slug)}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(content),
        },
      );
      const confirmed: unknown = await response.json().catch(() => null);
      if (!response.ok || !parsePortalChatMessage(confirmed)) {
        throw new Error("Mock Portal publish unavailable");
      }
      setMessages((current) => replaceMessage(current, temporaryId, confirmed));
    } catch (error) {
      setMessages((current) =>
        replaceMessage(current, temporaryId, {
          ...pendingMessage,
          status: "failed",
        }),
      );
      throw error;
    }
  }

  return (
    <ChatSurface
      channel={channel}
      hasPrevious={hasPrevious}
      identityId={identityId}
      isLoadingPrevious={isLoadingPrevious}
      loadPrevious={loadPrevious}
      messages={messages}
      onTyping={() => {}}
      onContentVisible={() => onContentVisible(channel.id)}
      onReact={onReact}
      onRetryConnection={() => {
        setReadWhenVisible(false);
        void loadMockHistory().then(setReadWhenVisible);
      }}
      onSend={sendMessage}
      readWhenVisible={readWhenVisible}
      reactionEvents={reactionEvents}
      reactionsEnabled={reactionsEnabled}
      status={status}
      presence={
        channel.mode === "broadcast"
          ? { kind: "aggregate", count: 1, recent: [] }
          : {
              kind: "detailed",
              participants: [{ id: identityId, anon: false }],
              count: 1,
            }
      }
      visible={visible}
    />
  );
}

function MockPortalOffice(
  props: Omit<MockPortalOfficeProps, "mode"> & {
    onOfficeDayExpired(): void;
    onEmploymentAccessEnded(access: EmploymentAccessDeniedDecision): void;
  },
) {
  const queryClient = useQueryClient();
  const {
    channels,
    identityId,
    displayName,
    employeeRecord,
    eventChannelId,
    officeDay: currentOfficeDay,
    isOperator,
    canSignOut,
    onOfficeDayExpired,
    onEmploymentAccessEnded,
  } = props;
  const { activeChannelId, setActiveChannelId } = useActiveOfficeChannel(
    channels,
    currentOfficeDay,
  );
  const navigation = useResponsiveOfficeNavigation();
  const inbox = useMockOfficeInbox();
  const inboxRows = useMemo(
    () =>
      reconcileOfficeInbox({
        channels,
        entries: inbox.entries,
        identityId,
        displayName,
      }),
    [channels, displayName, identityId, inbox.entries],
  );
  const inboxRowsByChannelId = new Map(
    inboxRows.map((row) => [row.channelId, row]),
  );
  const selectChannel = useCallback(
    (channelId: string) => {
      setActiveChannelId(channelId);
      navigation.showConversation();
    },
    [navigation.showConversation, setActiveChannelId],
  );
  const markInboxRead = useCallback(
    (channelId: string) => void inbox.markAsRead(channelId),
    [inbox.markAsRead],
  );
  const [reactionEvents, setReactionEvents] = useState<ReactionOfficeEvent[]>(
    [],
  );
  const [reactionStatus, setReactionStatus] =
    useState<ChannelStatus>("connecting");
  const seenMockOfficeEventKeys = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    async function loadOfficeEventHistory(): Promise<void> {
      try {
        const events = await fetchMockOfficeEvents(eventChannelId);
        if (!cancelled) {
          for (const event of events) {
            if (seenMockOfficeEventKeys.current.has(event.eventKey)) continue;
            seenMockOfficeEventKeys.current.add(event.eventKey);
            switch (event.type) {
              case "reaction.changed":
                setReactionEvents((current) =>
                  appendReactionEvent(current, event),
                );
                break;
              case "message-removal.invalidated":
                void invalidateMessageRemovals(queryClient);
                break;
              case "report.invalidated":
                void invalidateHRReportQueue(queryClient);
                break;
              case "profile.invalidated":
                void invalidateProfileBatches(queryClient, event.profileId);
                if (event.profileId === identityId) {
                  recheckEmploymentAccess(
                    onEmploymentAccessEnded,
                    ignoreMockEmploymentAccessError,
                  );
                }
                break;
              case "employment.invalidated":
                if (event.newHireId === identityId) {
                  recheckEmploymentAccess(
                    onEmploymentAccessEnded,
                    ignoreMockEmploymentAccessError,
                  );
                }
                break;
            }
          }
          setReactionStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setReactionEvents([]);
          setReactionStatus("reconnecting");
          recheckEmploymentAccess(
            onEmploymentAccessEnded,
            ignoreMockEmploymentAccessError,
          );
        }
      }
    }
    void loadOfficeEventHistory();
    const interval = window.setInterval(
      () => void loadOfficeEventHistory(),
      300,
    );
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [eventChannelId, identityId, onEmploymentAccessEnded, queryClient]);

  const publishMockReaction = useCallback(
    async (event: ReactionOfficeEvent): Promise<void> => {
      const response = await fetch("/api/office/portal/mock-events", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });
      const message: unknown = await response.json().catch(() => null);
      const parsed = parseOfficeEventMessage(message, eventChannelId);
      if (!response.ok || parsed?.event.type !== "reaction.changed") {
        throw new Error("Mock Portal reaction publish unavailable");
      }
      const reactionEvent = parsed.event;
      setReactionEvents((current) =>
        appendReactionEvent(current, reactionEvent),
      );
    },
    [eventChannelId],
  );
  const updateReaction = useReactionPublisher({
    identityId,
    eventChannelId,
    publish: publishMockReaction,
  });

  return (
    <OfficeWorkspace
      activeChannelId={activeChannelId}
      canSignOut={canSignOut}
      channels={channels}
      displayName={displayName}
      employeeRecord={employeeRecord}
      identityId={identityId}
      inboxRows={inboxRows}
      inboxStatus={inbox.status}
      isMobile={navigation.isMobile}
      isOperator={isOperator}
      mobileNavigationOpen={navigation.mobileNavigationOpen}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
    >
      {channels.map((channel) => (
        <MockOfficeChannel
          channel={channel}
          identityId={identityId}
          key={channel.id}
          latestActivityAt={
            inboxRowsByChannelId.get(channel.id)?.preview?.at ?? 0
          }
          onContentVisible={markInboxRead}
          onReact={updateReaction}
          reactionEvents={reactionEvents}
          reactionsEnabled={reactionStatus === "ready"}
          officeDay={currentOfficeDay}
          onOfficeDayExpired={onOfficeDayExpired}
          visible={
            navigation.conversationVisible && channel.id === activeChannelId
          }
        />
      ))}
    </OfficeWorkspace>
  );
}

function ShiftEndedDialog({ onContinue }: { onContinue(): void }) {
  const continueButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    continueButtonRef.current?.focus();
  }, []);

  return (
    <div className="shift-ended-backdrop">
      <section
        aria-describedby="shift-ended-description"
        aria-labelledby="shift-ended-title"
        aria-modal="true"
        className="shift-ended-dialog"
        role="dialog"
      >
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="shift-ended-content">
          <h2 id="shift-ended-title">A new Office Day is ready</h2>
          <p id="shift-ended-description">
            Continue to today&apos;s fresh channels and conversations.
          </p>
          <Button
            onClick={onContinue}
            ref={continueButtonRef}
            type="button"
            variant="primary"
          >
            Continue to the new Office Day
          </Button>
        </div>
      </section>
    </div>
  );
}

function EmploymentAccessEndedDialog({
  access,
}: {
  access: EmploymentAccessDeniedDecision;
}) {
  const copy = getEmploymentAccessEndedCopy(access.reason);
  return (
    <div className="shift-ended-backdrop">
      <section
        aria-labelledby="sent-home-title"
        aria-modal="true"
        className="shift-ended-dialog"
        role="dialog"
      >
        <header className="window-titlebar">
          <span>Portal Messenger</span>
        </header>
        <div className="shift-ended-content">
          <h2 id="sent-home-title">{copy.title}</h2>
          <p>{copy.description}</p>
          {access.until ? (
            <time dateTime={access.until.toISOString()}>
              {access.until.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function createOfficeDayWorkspace(
  currentOfficeDay: string,
): OfficeDayWorkspace {
  return {
    channels: listOfficeChannelsForDay(currentOfficeDay),
    eventChannelId: officeEventChannelIdForDay(currentOfficeDay),
    officeDay: currentOfficeDay,
  };
}

function PortalChatWorkspace(props: PortalChatProps): ReactNode {
  const applicationSafety = useApplicationSafetyControl();
  const [workspace, setWorkspace] = useState<OfficeDayWorkspace>(() => ({
    channels: props.channels,
    eventChannelId: props.eventChannelId,
    officeDay: props.officeDay,
  }));
  const [endedOfficeDay, setEndedOfficeDay] = useState<string | null>(null);
  const [focusNewOffice, setFocusNewOffice] = useState(false);
  const [employmentAccessEnded, setEmploymentAccessEnded] =
    useState<EmploymentAccessDeniedDecision | null>(null);

  const endOfficeDay = useCallback(() => {
    setEndedOfficeDay((current) => current ?? workspace.officeDay);
  }, [workspace.officeDay]);

  useEffect(() => {
    if (endedOfficeDay) return;
    return observeOfficeDayBoundary({
      currentOfficeDay: workspace.officeDay,
      onBoundary: endOfficeDay,
    });
  }, [endedOfficeDay, endOfficeDay, workspace.officeDay]);

  useEffect(() => {
    if (!focusNewOffice || endedOfficeDay) return;
    const focusComposer = () => {
      const firstChannelId = workspace.channels[0]?.id;
      const composer = firstChannelId
        ? document.getElementById(`message-${firstChannelId}`)
        : null;
      if (composer instanceof HTMLTextAreaElement && !composer.disabled) {
        composer.focus();
        setFocusNewOffice(false);
        return true;
      }
      return false;
    };
    if (focusComposer()) return;
    const observer = new MutationObserver(() => {
      if (focusComposer()) observer.disconnect();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["disabled"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, [endedOfficeDay, focusNewOffice, workspace.channels]);

  function continueToCurrentOfficeDay(): void {
    setWorkspace(createOfficeDayWorkspace(officeDay()));
    setEndedOfficeDay(null);
    setFocusNewOffice(true);
  }

  if (applicationSafety === "unavailable") {
    return (
      <div className="safety-outage application-safety-outage" role="alert">
        <strong>Portal Messenger safety control is unavailable.</strong>
        <span className="outage-detail">
          Active chat and publishing are paused. Please try again later.
        </span>
      </div>
    );
  }

  if (employmentAccessEnded) {
    return <EmploymentAccessEndedDialog access={employmentAccessEnded} />;
  }

  if (endedOfficeDay) {
    return <ShiftEndedDialog onContinue={continueToCurrentOfficeDay} />;
  }

  if (props.mode === "live") {
    return (
      <LivePortalOffice
        {...props}
        {...workspace}
        key={workspace.officeDay}
        onOfficeDayExpired={endOfficeDay}
        onEmploymentAccessEnded={setEmploymentAccessEnded}
      />
    );
  }
  return (
    <MockPortalOffice
      {...props}
      {...workspace}
      key={workspace.officeDay}
      onOfficeDayExpired={endOfficeDay}
      onEmploymentAccessEnded={setEmploymentAccessEnded}
    />
  );
}

export function PortalChat(props: PortalChatProps): ReactNode {
  return (
    <ProfileQueryProvider>
      <PortalChatWorkspace {...props} />
    </ProfileQueryProvider>
  );
}
