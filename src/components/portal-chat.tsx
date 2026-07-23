"use client";

import { useAuth } from "@clerk/nextjs";
import {
  type AggregatePresence,
  type ChannelStatus,
  type DetailedPresence,
  type InboxStatus,
  type Message,
  Portal,
  type PortalError,
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
  type OfficeInvalidationEvent,
  type OfficeReaction,
  officeEventChannelIdForDay,
  type ProjectedOfficeReaction,
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
  createChatContentWithMentions,
  linkifyChatText,
  type PortalChatContent,
  type SafePortalChatMessage,
} from "@/lib/portal/chat";
import { createPortalTokenSource } from "@/lib/portal/client";
import { type OfficeInboxRow, reconcileOfficeInbox } from "@/lib/portal/inbox";
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

type PortalChatProps = PortalOfficeBaseProps & {
  mode: "live";
  publishableKey: string;
};

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
  onSend(
    content: PortalChatContent,
    mentions: readonly { userId: string }[],
  ): Promise<void>;
  onRetryConnection(): void;
  loadPrevious?: () => Promise<unknown>;
  hasPrevious?: boolean;
  isLoadingPrevious?: boolean;
  onContentVisible?(): void;
  mentionMessageId?: string;
  onMentionVisible?(): void;
  channelError?: string | null;
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
  mentionedChannelIds: ReadonlySet<string>;
  mentionAnnouncement: string;
  children: ReactNode;
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

type ResponsiveOfficeNavigation = {
  isMobile: boolean | null;
  mobileNavigationOpen: boolean;
  conversationVisible: boolean;
  openMobileNavigation(): void;
  showConversation(): void;
};

type DraftMention = {
  userId: string;
  label: string;
};

function DraftMentionOverlay({
  text,
  mentions,
}: {
  text: string;
  mentions: readonly DraftMention[];
}) {
  const ranges = mentions
    .map((mention) => ({
      ...mention,
      start: text.indexOf(mention.label),
    }))
    .filter(({ start }) => start >= 0)
    .toSorted((left, right) => left.start - right.start);
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue;
    content.push(text.slice(cursor, range.start));
    content.push(
      <mark className="composer-mention" key={`${range.userId}-${range.start}`}>
        {range.label}
      </mark>,
    );
    cursor = range.start + range.label.length;
  }
  content.push(text.slice(cursor));

  return <>{content}</>;
}

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

function appendReactionEvent(
  events: readonly ReactionOfficeEvent[],
  event: ReactionOfficeEvent,
): ReactionOfficeEvent[] {
  if (events.some(({ eventKey }) => eventKey === event.eventKey)) {
    return [...events];
  }
  return [...events, event];
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

function SafeMessageText({
  content,
  identityId,
  profilesById,
}: {
  content: PortalChatContent;
  identityId?: string;
  profilesById?: ReadonlyMap<string, ProfileAttribution>;
}) {
  const ranges = content.mentionRanges ?? [];
  let characterOffset = 0;
  const renderText = (text: string) =>
    linkifyChatText(text).map((part) => {
      const key = `${part.kind}-${characterOffset}-${part.value}`;
      characterOffset += part.value.length;
      return part.kind === "link" ? (
        <a
          href={part.value}
          key={key}
          rel="noopener noreferrer"
          target="_blank"
        >
          {part.value}
        </a>
      ) : (
        <span key={key}>{part.value}</span>
      );
    });
  if (ranges.length === 0) return renderText(content.text);

  const rendered: ReactNode[] = [];
  let cursor = 0;
  for (const range of ranges) {
    rendered.push(...renderText(content.text.slice(cursor, range.start)));
    const label = content.text.slice(range.start, range.start + range.length);
    rendered.push(
      <a
        className="message-mention"
        data-current-new-hire={range.userId === identityId}
        href={`/office?profile=${encodeURIComponent(range.userId)}`}
        key={`mention-${range.start}-${range.userId}`}
      >
        {profilesById?.has(range.userId) ? label : "@New Hire"}
      </a>,
    );
    characterOffset += range.length;
    cursor = range.start + range.length;
  }
  rendered.push(...renderText(content.text.slice(cursor)));
  return rendered;
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
        <SafeMessageText content={message.content} />
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
            className={`chat-message chat-message-${message.status}${message.mentionedUserIds.includes(identityId) ? " chat-message-mentioned" : ""}`}
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
              <SafeMessageText
                content={message.content}
                identityId={identityId}
                profilesById={profilesById}
              />
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
  mentionMessageId,
  onMentionVisible,
  channelError,
}: ChatSurfaceProps) {
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([]);
  const [mentionSearch, setMentionSearch] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerOverlayRef = useRef<HTMLDivElement>(null);
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
  const presentIds =
    channel.mode === "standard" && presence?.kind === "detailed"
      ? currentDetailedNewHireIds(presence, status)
      : [];
  const participantIds = useMemo(
    () => [
      ...new Set([
        identityId,
        ...presentIds,
        ...messages.filter(isNewHireMessage).map(({ senderId }) => senderId),
      ]),
    ],
    [identityId, messages, presentIds],
  );
  const profileIds = useMemo(() => participantIds, [participantIds]);
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
  const mentionCandidates = mentionSearch
    ? [...profilesById.values()]
        .filter(({ clerkUserId }) => clerkUserId !== identityId)
        .filter(({ displayName }) =>
          displayName
            .toLocaleLowerCase()
            .includes(mentionSearch.query.toLocaleLowerCase()),
        )
        .toSorted((left, right) =>
          left.displayName.localeCompare(right.displayName),
        )
        .slice(0, 6)
    : [];
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
    if (!visible || !messageHistoryReady || !mentionMessageId) return;
    const element = surfaceRef.current?.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(mentionMessageId)}"]`,
    );
    if (!element) return;
    followingLatestMessage.current = false;
    element.scrollIntoView({ block: "center" });
    element.focus({ preventScroll: true });
    onMentionVisible?.();
  }, [mentionMessageId, messageHistoryReady, onMentionVisible, visible]);

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
      content = createChatContentWithMentions(draft, draftMentions);
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Invalid message.");
      return;
    }

    const submittedMentions = draftMentions;
    setDraft("");
    setDraftMentions([]);
    setMentionSearch(null);
    setIsSending(true);
    try {
      await onSend(
        content,
        [
          ...new Set(content.mentionRanges?.map(({ userId }) => userId) ?? []),
        ].map((userId) => ({ userId })),
      );
    } catch {
      setDraft(content.text);
      setDraftMentions(submittedMentions);
      setSendError("Message not delivered. Your text is ready to retry.");
    } finally {
      setIsSending(false);
    }
  }

  function updateMentionSearch(
    text: string,
    cursor: number,
    previousText: string,
  ): void {
    if (!mentionSearch) {
      const typedAt =
        text.length === previousText.length + 1 && text[cursor - 1] === "@";
      if (typedAt) {
        setMentionSearch({ start: cursor - 1, end: cursor, query: "" });
      }
      return;
    }

    const query = text.slice(mentionSearch.start + 1, cursor);
    if (
      cursor <= mentionSearch.start ||
      text[mentionSearch.start] !== "@" ||
      query.includes("@") ||
      query.includes("\n") ||
      query.length > 40
    ) {
      setMentionSearch(null);
      return;
    }
    setMentionSearch({
      start: mentionSearch.start,
      end: cursor,
      query: query.trimStart(),
    });
  }

  function selectMention(profile: ProfileAttribution): void {
    if (!mentionSearch) return;
    const label = `@${profile.displayName}`;
    const nextDraft = `${draft.slice(0, mentionSearch.start)}${label} ${draft.slice(mentionSearch.end)}`;
    const cursor = mentionSearch.start + label.length + 1;
    setDraft(nextDraft);
    setDraftMentions((current) => [
      ...current.filter(({ userId }) => userId !== profile.clerkUserId),
      { userId: profile.clerkUserId, label },
    ]);
    setMentionSearch(null);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(cursor, cursor);
    });
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
          {channelError ? (
            <p className="chat-error" role="alert">
              {channelError}
            </p>
          ) : null}
          {messageHistory}
        </div>
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor={`message-${channel.id}`}>
          Message # {channel.name}
        </label>
        <div className="composer-input-shell">
          <div
            aria-hidden="true"
            className="composer-highlight-layer"
            ref={composerOverlayRef}
          >
            <DraftMentionOverlay mentions={draftMentions} text={draft} />
            {draft.endsWith("\n") ? "\n " : null}
          </div>
          <Textarea
            disabled={!canPublish}
            id={`message-${channel.id}`}
            maxLength={CHAT_TEXT_LIMIT}
            onChange={(event) => {
              const nextDraft = event.target.value;
              setDraft(nextDraft);
              updateMentionSearch(
                nextDraft,
                event.target.selectionStart ?? nextDraft.length,
                draft,
              );
              if (
                visible &&
                canPublish &&
                channel.mode === "standard" &&
                nextDraft.trim().length > 0
              ) {
                onTyping();
              }
            }}
            onKeyDown={(event) => {
              if (!mentionSearch) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setMentionSearch(null);
              } else if (
                (event.key === "Enter" || event.key === "Tab") &&
                mentionCandidates[0]
              ) {
                event.preventDefault();
                selectMention(mentionCandidates[0]);
              }
            }}
            onScroll={(event) => {
              if (!composerOverlayRef.current) return;
              composerOverlayRef.current.scrollTop =
                event.currentTarget.scrollTop;
              composerOverlayRef.current.scrollLeft =
                event.currentTarget.scrollLeft;
            }}
            placeholder={canPublish ? "Type a message…" : "Reconnecting…"}
            ref={composerRef}
            rows={3}
            value={draft}
          />
        </div>
        {mentionSearch ? (
          <div className="mention-autocomplete">
            <strong className="mention-autocomplete-heading">
              Mention a New Hire
            </strong>
            {mentionCandidates.length > 0 ? (
              <ul>
                {mentionCandidates.map((profile) => (
                  <li key={profile.clerkUserId}>
                    <button
                      onClick={() => selectMention(profile)}
                      type="button"
                    >
                      <ProfileAvatar
                        placeholderClassName="mention-avatar-placeholder"
                        profile={profile}
                        size={24}
                      />
                      {profile.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="mention-autocomplete-empty">
                No matching New Hires
              </span>
            )}
          </div>
        ) : null}
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
  mentionedChannelIds,
  mentionAnnouncement,
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
        <p className="sr-only" aria-live="polite">
          {mentionAnnouncement}
        </p>
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
                  {mentionedChannelIds.has(channel.id) ? (
                    <span className="mention-badge">
                      <span className="sr-only">Mentioned you</span>
                      <span aria-hidden="true">@</span>
                    </span>
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
  mentionMessageId,
  onMention,
  onMentionVisible,
}: ReactionProps & {
  visible: boolean;
  channel: OfficeChannel;
  identityId: string;
  onInboxRead(channelId: string): void;
  mentionMessageId?: string;
  onMention(channel: OfficeChannel, message: Message<{ text: string }>): void;
  onMentionVisible(channelId: string): void;
}) {
  const [channelError, setChannelError] = useState<string | null>(null);
  const channel = useChannel<{ text: string }>({
    channelId: officeChannel.id,
    history: 50,
    readOn: "manual",
    onMention: (message) => onMention(officeChannel, message),
    onError: (_error: PortalError) => {
      setChannelError(
        "This Office Channel hit a connection problem. Retry if updates do not resume.",
      );
    },
  });
  useEffect(() => {
    if (channel.status === "ready") setChannelError(null);
  }, [channel.status]);
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
      mentionMessageId={mentionMessageId}
      onMentionVisible={() => onMentionVisible(officeChannel.id)}
      onTyping={channel.sendTyping}
      onReact={onReact}
      onRetryConnection={() => window.location.reload()}
      onContentVisible={markVisibleContentRead}
      onSend={async (content, mentions) => {
        await channel.send({
          content,
          ...(mentions.length > 0 ? { mentions: [...mentions] } : {}),
        });
      }}
      reactionEvents={reactionEvents}
      reactionsEnabled={reactionsEnabled}
      status={channel.status}
      presence={channel.presence}
      channelError={channelError}
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
}: Omit<PortalChatProps, "mode" | "publishableKey"> & {
  onEmploymentAccessEnded(access: EmploymentAccessDeniedDecision): void;
}) {
  const queryClient = useQueryClient();
  const [reactionEvents, setReactionEvents] = useState<ReactionOfficeEvent[]>(
    [],
  );
  const [mentionsByChannelId, setMentionsByChannelId] = useState(
    new Map<string, string>(),
  );
  const [mentionAnnouncement, setMentionAnnouncement] = useState("");
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
  const handleMention = useCallback(
    (channel: OfficeChannel, message: Message<{ text: string }>) => {
      setMentionsByChannelId((current) => {
        if (current.has(channel.id)) return current;
        const next = new Map(current);
        next.set(channel.id, message.id);
        return next;
      });
      setMentionAnnouncement(`You were mentioned in ${channel.name}.`);
    },
    [],
  );
  const clearMention = useCallback((channelId: string) => {
    setMentionsByChannelId((current) => {
      if (!current.has(channelId)) return current;
      const next = new Map(current);
      next.delete(channelId);
      return next;
    });
  }, []);

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
      mentionedChannelIds={new Set(mentionsByChannelId.keys())}
      mentionAnnouncement={mentionAnnouncement}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
    >
      {channels.map((channel) => (
        <LiveOfficeChannel
          channel={channel}
          identityId={identityId}
          key={channel.id}
          mentionMessageId={mentionsByChannelId.get(channel.id)}
          onMention={handleMention}
          onMentionVisible={clearMention}
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
  props: Omit<PortalChatProps, "mode"> & {
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

export function PortalChat(props: PortalChatProps): ReactNode {
  return (
    <ProfileQueryProvider>
      <PortalChatWorkspace {...props} />
    </ProfileQueryProvider>
  );
}
