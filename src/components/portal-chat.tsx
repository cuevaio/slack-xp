"use client";

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
import { fetchEmploymentAccess } from "@/lib/employment/client";
import type {
  EmploymentAccessDeniedDecision,
  SafePublicSendHomeSystemEventMessage,
  SafePublicTerminationSystemEventMessage,
} from "@/lib/employment/contract";
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
  type HRReportInboxItem,
  type OfficeInboxEntry,
  type OfficeInboxRow,
  parseHRReportInboxItem,
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
  currentTypingNewHireIds,
  hasCurrentRealtimeState,
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

type PortalPresence = DetailedPresence | AggregatePresence;

type PortalOfficeBaseProps = {
  channels: readonly OfficeChannel[];
  identityId: string;
  displayName: string;
  imageUrl: string | null;
  employeeRecord: ReactNode;
  eventChannelId: string;
  officeDay: string;
  jobTitle: string;
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

function hrReportNotificationCopy(notification: HRReportInboxItem): {
  actionLabel: string;
  summary: string;
} {
  if (notification.subjectType === "message") {
    return {
      actionLabel: "open message context",
      summary: `${notification.officeDay} · Open message context`,
    };
  }

  return {
    actionLabel: "open current New Hire Profile",
    summary: "Open current New Hire Profile",
  };
}

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
  typingUserIds: readonly string[];
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
  | "jobTitle"
  | "isOperator"
  | "canSignOut"
> & {
  activeChannelId: string;
  inboxRows: readonly OfficeInboxRow[];
  inboxStatus: InboxStatus;
  reportNotifications: readonly HRReportInboxItem[];
  isMobile: boolean | null;
  mobileNavigationOpen: boolean;
  onOpenMobileNavigation(): void;
  onSelectChannel(channelId: string): void;
  onReadReportNotification(notificationId: string): void;
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
  presence?: PortalPresence;
  status: ChannelStatus;
  typingUserIds: readonly string[];
};

type MockOfficeInbox = {
  entries: readonly OfficeInboxEntry[];
  reportNotifications: readonly HRReportInboxItem[];
  status: InboxStatus;
  markAsRead(channelId: string): Promise<void>;
  markReportNotificationAsRead(notificationId: string): Promise<void>;
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
      return "Inbox current";
    case "reconnecting":
      return "Reconnecting inbox…";
    case "idle":
    case "connecting":
      return "Loading inbox…";
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
  if (query.isError) return { status: "error", profiles: [] };
  if (query.isPending) return { status: "loading", profiles: [] };
  return { status: "ready", profiles: query.data };
}

function typingCopy(names: readonly string[]): string {
  if (names.length === 1) {
    return `${names[0]} is typing…`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} are typing…`;
  }
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing…`;
}

function DetailedPresenceContent({
  channel,
  detailedPresence,
  presentIds,
  profileIds,
  profilesById,
  resolutionStatus,
}: {
  channel: OfficeChannel;
  detailedPresence: DetailedPresence | undefined;
  presentIds: readonly string[];
  profileIds: readonly string[];
  profilesById: ReadonlyMap<string, ProfileAttribution>;
  resolutionStatus: ProfileResolution["status"];
}) {
  if (!detailedPresence) {
    return <span>Loading current presence…</span>;
  }

  if (resolutionStatus === "loading") {
    return (
      <span aria-live="polite">
        Resolving {profileIds.length.toLocaleString()} New Hire Profile
        {profileIds.length === 1 ? "" : "s"}…
      </span>
    );
  }

  if (resolutionStatus === "error") {
    return (
      <span role="alert">
        New Hire Profiles are unavailable. The detailed roster is hidden.
      </span>
    );
  }

  if (presentIds.length === 0) {
    return <span>No New Hires are currently present.</span>;
  }

  return (
    <ul aria-label={`${channel.name} current New Hires`}>
      {presentIds.map((userId) => {
        const profile = profilesById.get(userId);
        return (
          <li data-new-hire-id={userId} key={userId}>
            <a
              aria-label={`Open current New Hire Profile for ${profileDisplayName(profile)}`}
              className="profile-context-trigger"
              href={`/office?profile=${encodeURIComponent(userId)}`}
            >
              <ProfileAvatar
                placeholderClassName="new-hire-presence-dot"
                profile={profile}
                size={22}
              />
              <span>
                <strong>{profile?.displayName ?? "New Hire"}</strong>
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
  presence,
  status,
  typingUserIds,
}: LiveActivityProps) {
  const detailedPresence =
    channel.mode === "standard" && presence?.kind === "detailed"
      ? presence
      : undefined;
  const presentIds = currentDetailedNewHireIds(detailedPresence, status);
  const currentTypingIds = currentTypingNewHireIds(typingUserIds, status);
  const profileIds = [...new Set([...presentIds, ...currentTypingIds])];
  const resolution = useResolvedNewHireProfiles(
    profileIds,
    active && channel.mode === "standard",
  );
  const profilesById = new Map(
    resolution.profiles.map((profile) => [profile.clerkUserId, profile]),
  );
  const typingNames = currentTypingIds.map(
    (userId) => profilesById.get(userId)?.displayName ?? "New Hire",
  );

  if (!hasCurrentRealtimeState(status)) {
    return (
      <aside className="live-activity-panel presence-unavailable">
        <strong>Live presence unavailable</strong>
        <span>
          {status === "idle" || status === "connecting"
            ? "Checking who is currently in this Office Channel…"
            : "The roster and typing activity are hidden until Portal reconnects."}
        </span>
      </aside>
    );
  }

  if (channel.mode === "broadcast") {
    return (
      <aside className="live-activity-panel aggregate-presence">
        <strong>All-hands attendance</strong>
        {presence?.kind === "aggregate" ? (
          <span>
            {presence.count.toLocaleString()} New Hire
            {presence.count === 1 ? " is" : "s are"} currently connected.
          </span>
        ) : (
          <span>Loading the aggregate attendance count…</span>
        )}
      </aside>
    );
  }

  return (
    <aside className="live-activity-panel detailed-presence">
      <div className="presence-summary">
        <strong>New Hires present</strong>
        <span>{presentIds.length.toLocaleString()} connected</span>
      </div>
      <DetailedPresenceContent
        channel={channel}
        detailedPresence={detailedPresence}
        presentIds={presentIds}
        profileIds={profileIds}
        profilesById={profilesById}
        resolutionStatus={resolution.status}
      />
      <output className="typing-indicator" aria-live="polite">
        {typingNames.length > 0 ? typingCopy(typingNames) : ""}
      </output>
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
  const [reportNotifications, setReportNotifications] = useState<
    readonly HRReportInboxItem[]
  >([]);
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
      setReportNotifications(snapshot.reportNotifications);
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

  const markReportNotificationAsRead = useCallback(
    async (notificationId: string) => {
      const response = await fetch("/api/office/portal/mock-inbox", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
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
    reportNotifications,
    status,
    markAsRead,
    markReportNotificationAsRead,
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
}: {
  message: SafePublicSendHomeSystemEventMessage;
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
        <strong>Portal Systems Operations</strong>
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {formatOfficeTimestamp(message.timestamp)}
        </time>
      </div>
      <p>
        Operator {message.operatorId} sent New Hire {message.targetNewHireId}{" "}
        home until the next Office Day.
      </p>
    </li>
  );
}

function TerminationSystemEventListItem({
  message,
}: {
  message: SafePublicTerminationSystemEventMessage;
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
        <strong>Portal Systems Operations</strong>
        <time dateTime={new Date(message.timestamp).toISOString()}>
          {formatOfficeTimestamp(message.timestamp)}
        </time>
      </div>
      <p>
        Operator {message.operatorId}{" "}
        {message.action === "terminated" ? "terminated" : "reinstated"} New Hire{" "}
        {message.targetNewHireId}.
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
        <strong>The {channel.name} Office Channel is quiet.</strong>
        <p>
          Start today&apos;s paper trail. Confirmed messages survive reconnects.
        </p>
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
        if (isPublicTerminationSystemEventMessage(message)) {
          return (
            <TerminationSystemEventListItem
              key={message.id}
              message={message}
            />
          );
        }
        if (isPublicSendHomeSystemEventMessage(message)) {
          return (
            <SendHomeSystemEventListItem key={message.id} message={message} />
          );
        }
        if (isScriptedSystemEventMessage(message)) {
          return (
            <ScriptedSystemEventListItem key={message.id} message={message} />
          );
        }
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
  typingUserIds,
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
  const surfaceRef = useRef<HTMLElement>(null);
  const latestOnContentVisible = useRef(onContentVisible);
  const parsedMessages = useMemo(
    () => parseOfficeChannelMessages(rawMessages, channel.id),
    [channel.id, rawMessages],
  );
  const messages = parsedMessages.messages;
  const invalidMessageCount = parsedMessages.invalidCount;
  const latestMessageId = messages.at(-1)?.id ?? null;
  const removalQuery = useMessageRemovals(channel.id);
  const removedMessageIds = useMemo(
    () => new Set((removalQuery.data ?? []).map(({ messageId }) => messageId)),
    [removalQuery.data],
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
  const messageHistoryReady =
    !removalQuery.isPending &&
    !removalQuery.isError &&
    !profileQuery.isPending &&
    !profileQuery.isError;
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
  if (removalQuery.isError) {
    messageHistory = (
      <div className="portal-outage" role="alert">
        <strong>Removed Message records are unavailable.</strong>
        <span className="outage-detail">
          Message history is hidden until canonical removal records return.
        </span>
      </div>
    );
  } else if (removalQuery.isPending) {
    messageHistory = (
      <p className="profile-status">Checking Removed Messages…</p>
    );
  } else if (profileQuery.isError) {
    messageHistory = (
      <div className="portal-outage" role="alert">
        <strong>New Hire Profiles are unavailable.</strong>
        <span className="outage-detail">
          Message history is hidden until canonical profile records return.
        </span>
      </div>
    );
  } else if (profileQuery.isPending) {
    messageHistory = (
      <p className="profile-status">Resolving New Hire Profiles…</p>
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
    let remainingFrames = 10;
    const restoreScrollPosition = () => {
      const nextHeight = region.scrollHeight;
      if (nextHeight === previousHeight && remainingFrames > 0) {
        remainingFrames -= 1;
        requestAnimationFrame(restoreScrollPosition);
        return;
      }
      region.scrollTop = previousTop + nextHeight - previousHeight;
    };
    requestAnimationFrame(restoreScrollPosition);
  }

  const canPublish = isChatContentReady(status);
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
          {channel.mode === "broadcast" ? (
            <span className="channel-mode-badge">Broadcast</span>
          ) : null}
          <span className="channel-purpose">{channel.purpose}</span>
        </div>
        <output className="connection-status" aria-live="polite">
          {connectionStatusCopy(status)}
        </output>
      </header>

      <div className="chat-scroll-region" ref={scrollRegionRef}>
        <LiveActivity
          active={visible}
          channel={channel}
          presence={presence}
          status={status}
          typingUserIds={typingUserIds}
        />
        {channel.mode === "broadcast" ? (
          <aside className="broadcast-notice">
            <strong>System Events receive priority display.</strong>
            <span>
              Broadcast mode changes presentation and presence only. Every
              authenticated New Hire can still publish here.
            </span>
          </aside>
        ) : null}
        {hasPrevious && loadPrevious ? (
          <button
            className="classic-button load-history-button"
            disabled={isLoadingPrevious}
            onClick={() => void loadEarlier()}
            type="button"
          >
            {isLoadingPrevious ? "Loading…" : "Load earlier messages"}
          </button>
        ) : null}
        {status === "blocked" || status === "reconnecting" ? (
          <div className="portal-outage" aria-live="polite">
            <strong>Portal is offline.</strong>
            <span className="outage-detail">
              Confirmed history will return after the connection recovers.
            </span>
            <button
              className="classic-button"
              onClick={onRetryConnection}
              type="button"
            >
              Retry connection
            </button>
          </div>
        ) : null}
        {invalidMessageCount > 0 ? (
          <output className="invalid-message-notice">
            {invalidMessageCount} invalid message
            {invalidMessageCount === 1 ? " was" : "s were"} hidden.
          </output>
        ) : null}
        {messageHistory}
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor={`message-${channel.id}`}>
          Message # {channel.name}
        </label>
        <textarea
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
          placeholder={
            canPublish ? "Type a plain-text message…" : "Portal is offline"
          }
          rows={3}
          value={draft}
        />
        <div className="composer-actions">
          <span className="character-count">
            {draft.length.toLocaleString()} / 1,000
          </span>
          <button
            className="classic-button send-message-button"
            disabled={!canPublish || isSending || draft.trim().length === 0}
            type="submit"
          >
            {sendButtonCopy(isSending, sendError !== null)}
          </button>
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
  jobTitle,
  isOperator,
  canSignOut,
  activeChannelId,
  inboxRows,
  inboxStatus,
  reportNotifications,
  isMobile,
  mobileNavigationOpen,
  onOpenMobileNavigation,
  onSelectChannel,
  onReadReportNotification,
  children,
}: OfficeWorkspaceProps) {
  const currentProfile = useProfileBatch([identityId]);
  const operatorState = useOperatorState(isOperator);
  const hasOperatorAccess =
    !operatorState.isError && operatorState.data?.isOperator === true;
  const currentDisplayName =
    currentProfile.data?.find((profile) => profile.clerkUserId === identityId)
      ?.displayName ?? displayName;
  const directoryButtons = useRef(new Map<string, HTMLButtonElement>());
  const mobileDirectoryTrigger = useRef<HTMLButtonElement>(null);
  const inboxRowsByChannelId = new Map(
    inboxRows.map((row) => [row.channelId, row]),
  );
  const unreadHRReportNotifications = hasOperatorAccess
    ? reportNotifications.filter(({ read }) => !read).length
    : 0;
  const totalUnread =
    inboxRows.reduce((total, row) => total + row.unread, 0) +
    unreadHRReportNotifications;

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
          <p className="job-title">{jobTitle}</p>
          {hasOperatorAccess ? (
            <p className="operator-badge">Operator access</p>
          ) : null}
          <output className="inbox-status" aria-live="polite">
            {inboxStatusCopy(inboxStatus)}
          </output>
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
                    <small> {channel.name}</small>
                    <small className="channel-preview">
                      {row?.preview ? (
                        <>
                          <span className="channel-preview-sender">
                            {row.preview.sender}:
                          </span>{" "}
                          {row.preview.text}
                        </>
                      ) : (
                        "No messages yet"
                      )}
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
          {hasOperatorAccess ? (
            <section
              aria-label="HR Report notifications"
              className="hr-report-inbox"
            >
              <h2>HR Inbox</h2>
              {reportNotifications.length === 0 ? (
                <p>No open HR Report notifications.</p>
              ) : (
                <ul>
                  {reportNotifications.map((notification) => {
                    const copy = hrReportNotificationCopy(notification);
                    return (
                      <li key={notification.id}>
                        <a
                          aria-label={`${notification.title}, ${copy.actionLabel}`}
                          className={notification.read ? "is-read" : undefined}
                          href={notification.href}
                          onClick={() =>
                            onReadReportNotification(notification.id)
                          }
                        >
                          <strong>{notification.title}</strong>
                          <small>{copy.summary}</small>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}
          {employeeRecord}
          {canSignOut ? (
            <form action="/api/auth/sign-out" method="post">
              <button className="classic-button sign-out-button" type="submit">
                Sign out
              </button>
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
      <footer className="office-taskbar">
        <button
          aria-label={`Focus Office Channel directory, ${totalUnread} unread`}
          onClick={() => directoryButtons.current.get(activeChannelId)?.focus()}
          type="button"
        >
          <span aria-hidden="true">▣</span>
          Portal Messenger — {totalUnread} unread
        </button>
        <output aria-live="polite">{inboxStatusCopy(inboxStatus)}</output>
      </footer>
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
      typingUserIds={channel.typing}
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

function LivePortalWorkspace({
  channels,
  identityId,
  displayName,
  employeeRecord,
  eventChannelId,
  officeDay: currentOfficeDay,
  jobTitle,
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
          break;
        case "report.invalidated":
          void invalidateHRReportQueue(queryClient);
          break;
        case "message-removal.invalidated":
          void invalidateMessageRemovals(queryClient);
          break;
        case "employment.invalidated":
          if (event.newHireId === identityId) {
            void fetchEmploymentAccess()
              .then((access) => {
                if (!access.eligible) {
                  onEmploymentAccessEnded(access);
                }
              })
              .catch(() => window.location.reload());
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
  const reportNotifications = useMemo(
    () =>
      inbox.items.flatMap((item) => {
        const parsed = parseHRReportInboxItem(item);
        return parsed ? [parsed] : [];
      }),
    [inbox.items],
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
      reportNotifications={reportNotifications}
      isMobile={navigation.isMobile}
      isOperator={isOperator}
      jobTitle={jobTitle}
      mobileNavigationOpen={navigation.mobileNavigationOpen}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
      onReadReportNotification={(notificationId) => {
        inbox.items.find(({ id }) => id === notificationId)?.markAsRead();
      }}
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
      typingUserIds={[]}
      visible={visible}
    />
  );
}

function MockPortalOffice(
  props: Omit<MockPortalOfficeProps, "mode"> & {
    onOfficeDayExpired(): void;
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
    jobTitle,
    isOperator,
    canSignOut,
    onOfficeDayExpired,
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
            }
          }
          setReactionStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setReactionEvents([]);
          setReactionStatus("reconnecting");
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
  }, [eventChannelId, queryClient]);

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
      reportNotifications={inbox.reportNotifications}
      isMobile={navigation.isMobile}
      isOperator={isOperator}
      jobTitle={jobTitle}
      mobileNavigationOpen={navigation.mobileNavigationOpen}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
      onReadReportNotification={(notificationId) => {
        void inbox.markReportNotificationAsRead(notificationId);
      }}
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

function ShiftEndedDialog({
  endedOfficeDay,
  onContinue,
}: {
  endedOfficeDay: string;
  onContinue(): void;
}) {
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
          <span aria-hidden="true">×</span>
        </header>
        <div className="shift-ended-content">
          <p className="eyebrow">Office Day {endedOfficeDay}</p>
          <h2 id="shift-ended-title">Your shift has ended</h2>
          <p id="shift-ended-description">
            Midnight UTC has passed. Your old desk is disconnected and the new
            Office Day is ready with fresh channels.
          </p>
          <button
            className="classic-button primary-action"
            onClick={onContinue}
            ref={continueButtonRef}
            type="button"
          >
            Continue to the new Office Day
          </button>
        </div>
      </section>
    </div>
  );
}

function SentHomeDialog({
  access,
}: {
  access: EmploymentAccessDeniedDecision;
}) {
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
          <span aria-hidden="true">×</span>
        </header>
        <div className="shift-ended-content">
          <p className="eyebrow">Shared Public Office access ended</p>
          <h2 id="sent-home-title">You were sent home for this Office Day</h2>
          <p>
            Your Portal connections were closed. You can return automatically at
            the next midnight UTC Office Day boundary.
          </p>
          {access.until ? (
            <time dateTime={access.until.toISOString()}>
              {access.until.toISOString()}
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

  if (employmentAccessEnded) {
    return <SentHomeDialog access={employmentAccessEnded} />;
  }

  if (endedOfficeDay) {
    return (
      <ShiftEndedDialog
        endedOfficeDay={endedOfficeDay}
        onContinue={continueToCurrentOfficeDay}
      />
    );
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
    />
  );
}

export function PortalChat(props: PortalChatProps): ReactNode {
  const initialProfile: ProfileAttribution = {
    clerkUserId: props.identityId,
    displayName: props.displayName,
    imageUrl: props.imageUrl,
    status: "current",
  };

  return (
    <ProfileQueryProvider initialProfile={initialProfile}>
      <PortalChatWorkspace {...props} />
    </ProfileQueryProvider>
  );
}
