"use client";

import { Portal } from "@portalsdk/core";
import { PortalProvider, useChannel } from "@portalsdk/react";
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
import { useOfficeEventSubscription } from "@/lib/office-events/client";
import {
  createReactionOfficeEvent,
  createReactionProjection,
  OFFICE_REACTIONS,
  type OfficeReaction,
  type ProjectedOfficeReaction,
  parseOfficeEventMessage,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";
import type { OfficeChannel } from "@/lib/portal/channels";
import {
  CHAT_TEXT_LIMIT,
  linkifyChatText,
  type PortalChatContent,
  parsePortalChatMessage,
  type SafePortalChatMessage,
  validateChatDraft,
} from "@/lib/portal/chat";
import { createPortalTokenSource } from "@/lib/portal/client";

type ChatConnectionStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "degraded-http"
  | "blocked";

type PortalOfficeBaseProps = {
  channels: readonly OfficeChannel[];
  identityId: string;
  displayName: string;
  employeeRecord: ReactNode;
  eventChannelId: string;
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

type ChatSurfaceProps = ReactionProps & {
  active: boolean;
  channel: OfficeChannel;
  identityId: string;
  displayName: string;
  messages: readonly unknown[];
  status: ChatConnectionStatus;
  onSend(text: string): Promise<void>;
  onRetryConnection(): void;
  loadPrevious?: () => Promise<unknown>;
  hasPrevious?: boolean;
  isLoadingPrevious?: boolean;
};

type OfficeWorkspaceProps = Pick<
  PortalOfficeBaseProps,
  | "channels"
  | "displayName"
  | "employeeRecord"
  | "jobTitle"
  | "isOperator"
  | "canSignOut"
> & {
  activeChannelId: string;
  unreadCounts: Readonly<Record<string, number>>;
  onSelectChannel(channelId: string): void;
  children: ReactNode;
};

type MockHistoryPage = {
  messages: unknown[];
  hasPrevious: boolean;
};

const REACTION_NAMES: Record<OfficeReaction, string> = {
  "👍": "Thumbs up",
  "❤️": "Heart",
  "😂": "Laughing",
  "😮": "Surprised",
  "😢": "Sad",
  "🎉": "Celebrate",
};

function connectionStatusCopy(status: ChatConnectionStatus): string {
  switch (status) {
    case "ready":
      return "Online — messages are persistent";
    case "degraded-http":
      return "Reconnecting — sending remains available";
    case "degraded":
      return "Portal feature degraded — chat remains available";
    case "reconnecting":
      return "Offline — reconnecting to Portal";
    case "blocked":
      return "Portal connection refused — retry required";
    case "idle":
    case "connecting":
      return "Connecting to Portal…";
  }
}

function sendButtonCopy(isSending: boolean, hasError: boolean): string {
  if (isSending) {
    return "Sending…";
  }
  if (hasError) {
    return "Retry send";
  }
  return "Send";
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

async function fetchMockOfficeEvents(
  eventChannelId: string,
): Promise<ReactionOfficeEvent[]> {
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
    return parsed?.event.type === "reaction.changed" ? [parsed.event] : [];
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
    try {
      await onReact({
        officeChannelId: message.channelId,
        messageId: message.id,
        reaction,
        operation: operationFor(reaction),
      });
      setPickerOpen(false);
      triggerRef.current?.focus();
    } catch {
      setError("Reaction not saved. Choose it again to retry.");
    } finally {
      setIsUpdating(false);
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

function MessageHistory({
  channel,
  messages,
  identityId,
  displayName,
  reactionEvents,
  reactionsEnabled,
  onReact,
}: ReactionProps & {
  channel: OfficeChannel;
  messages: readonly SafePortalChatMessage[];
  identityId: string;
  displayName: string;
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
    messages.filter(({ status }) => status === "sent").map(({ id }) => id),
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
      {messages.map((message) => (
        <li
          className={`chat-message chat-message-${message.status}`}
          key={message.id}
        >
          <div className="message-meta">
            <strong>
              {message.senderId === identityId ? displayName : "New Hire"}
            </strong>
            <time dateTime={new Date(message.timestamp).toISOString()}>
              {new Intl.DateTimeFormat(undefined, {
                hour: "numeric",
                minute: "2-digit",
              }).format(message.timestamp)}
            </time>
          </div>
          <p>
            <SafeMessageText text={message.content.text} />
          </p>
          {message.status === "pending" ? <small>Sending…</small> : null}
          {message.status === "failed" ? (
            <small role="alert">Not delivered. Retry from the composer.</small>
          ) : null}
          {message.status === "sent" ? (
            <ReactionControls
              enabled={reactionsEnabled}
              identityId={identityId}
              message={message}
              onReact={onReact}
              reactions={projection.read(channel.id, message.id)}
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ChatSurface({
  active,
  channel,
  identityId,
  displayName,
  messages: rawMessages,
  status,
  reactionEvents,
  reactionsEnabled,
  onReact,
  onSend,
  onRetryConnection,
  loadPrevious,
  hasPrevious = false,
  isLoadingPrevious = false,
}: ChatSurfaceProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const messages = useMemo(
    () =>
      rawMessages
        .map(parsePortalChatMessage)
        .filter(
          (message): message is SafePortalChatMessage =>
            message !== null && message.channelId === channel.id,
        ),
    [channel.id, rawMessages],
  );
  const invalidMessageCount = rawMessages.length - messages.length;

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
    requestAnimationFrame(() => {
      if (region) {
        region.scrollTop = previousTop + region.scrollHeight - previousHeight;
      }
    });
  }

  const canPublish =
    status === "ready" || status === "degraded" || status === "degraded-http";
  const headingId = `office-channel-heading-${channel.slug}`;

  return (
    <section
      aria-labelledby={headingId}
      className={`general-chat ${channel.mode === "broadcast" ? "broadcast-chat" : ""}`}
      hidden={!active}
      id={`office-channel-${channel.slug}`}
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
        <MessageHistory
          channel={channel}
          displayName={displayName}
          identityId={identityId}
          messages={messages}
          onReact={onReact}
          reactionEvents={reactionEvents}
          reactionsEnabled={reactionsEnabled}
        />
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor={`message-${channel.id}`}>
          Message # {channel.name}
        </label>
        <textarea
          disabled={!canPublish}
          id={`message-${channel.id}`}
          maxLength={CHAT_TEXT_LIMIT}
          onChange={(event) => setDraft(event.target.value)}
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
  displayName,
  employeeRecord,
  jobTitle,
  isOperator,
  canSignOut,
  activeChannelId,
  unreadCounts,
  onSelectChannel,
  children,
}: OfficeWorkspaceProps) {
  return (
    <div className="office-body">
      <aside className="channel-panel" aria-label="Office Channels">
        <p className="eyebrow">Shared Public Office</p>
        <h1>Welcome, {displayName}</h1>
        <p className="job-title">{jobTitle}</p>
        {isOperator ? <p className="operator-badge">Operator access</p> : null}
        <nav aria-label="Office Channel directory">
          {channels.map((channel) => {
            const unreadCount = unreadCounts[channel.id] ?? 0;
            return (
              <button
                aria-controls={`office-channel-${channel.slug}`}
                aria-current={
                  channel.id === activeChannelId ? "page" : undefined
                }
                className="channel-button"
                key={channel.id}
                onClick={() => onSelectChannel(channel.id)}
                type="button"
              >
                <span className="channel-button-copy">
                  <strong># {channel.slug}</strong>
                  <small> {channel.name}</small>
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
        {employeeRecord}
        {canSignOut ? (
          <form action="/api/auth/sign-out" method="post">
            <button className="classic-button sign-out-button" type="submit">
              Sign out
            </button>
          </form>
        ) : null}
      </aside>
      <section className="conversation-panel">{children}</section>
    </div>
  );
}

function LiveOfficeChannel({
  active,
  channel: officeChannel,
  identityId,
  displayName,
  onUnread,
  onReact,
  reactionEvents,
  reactionsEnabled,
}: ReactionProps & {
  active: boolean;
  channel: OfficeChannel;
  identityId: string;
  displayName: string;
  onUnread(channelId: string, count: number): void;
}) {
  const channel = useChannel<{ text: string }>({
    channelId: officeChannel.id,
    history: 50,
    readOn: active ? "visible" : "manual",
  });

  useEffect(() => {
    onUnread(officeChannel.id, channel.unread);
  }, [channel.unread, officeChannel.id, onUnread]);

  return (
    <ChatSurface
      active={active}
      channel={officeChannel}
      displayName={displayName}
      hasPrevious={channel.hasPrevious}
      identityId={identityId}
      isLoadingPrevious={channel.isLoadingPrevious}
      loadPrevious={channel.loadPrevious}
      messages={channel.messages}
      onReact={onReact}
      onRetryConnection={() => window.location.reload()}
      onSend={async (text) => {
        await channel.send({ content: validateChatDraft(text) });
      }}
      reactionEvents={reactionEvents}
      reactionsEnabled={reactionsEnabled}
      status={channel.status}
    />
  );
}

function ignoreOfficeInvalidation(): void {}

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
          officeDay: eventChannelId.slice(0, 10),
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

function LivePortalWorkspace({
  channels,
  identityId,
  displayName,
  employeeRecord,
  eventChannelId,
  jobTitle,
  isOperator,
  canSignOut,
}: Omit<LivePortalOfficeProps, "mode" | "publishableKey">) {
  const [reactionEvents, setReactionEvents] = useState<ReactionOfficeEvent[]>(
    [],
  );
  const { status: eventStatus, publishReaction } = useOfficeEventSubscription({
    channelId: eventChannelId,
    onReaction: (event) => {
      setReactionEvents((current) => appendReactionEvent(current, event));
    },
    onInvalidation: ignoreOfficeInvalidation,
  });
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const updateUnread = useCallback((channelId: string, count: number) => {
    setUnreadCounts((current) => {
      if (current[channelId] === count) {
        return current;
      }
      return { ...current, [channelId]: count };
    });
  }, []);
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
      isOperator={isOperator}
      jobTitle={jobTitle}
      onSelectChannel={setActiveChannelId}
      unreadCounts={unreadCounts}
    >
      {channels.map((channel) => (
        <LiveOfficeChannel
          active={channel.id === activeChannelId}
          channel={channel}
          displayName={displayName}
          identityId={identityId}
          key={channel.id}
          onReact={updateReaction}
          onUnread={updateUnread}
          reactionEvents={reactionEvents}
          reactionsEnabled={reactionsEnabled}
        />
      ))}
    </OfficeWorkspace>
  );
}

function LivePortalOffice(props: Omit<LivePortalOfficeProps, "mode">) {
  const [portal] = useState(
    () =>
      new Portal({
        apiKey: props.publishableKey,
        token: createPortalTokenSource(),
      }),
  );

  return (
    <PortalProvider client={portal}>
      <LivePortalWorkspace {...props} />
    </PortalProvider>
  );
}

function MockOfficeChannel({
  active,
  channel,
  identityId,
  displayName,
  onReact,
  reactionEvents,
  reactionsEnabled,
}: ReactionProps & {
  active: boolean;
  channel: OfficeChannel;
  identityId: string;
  displayName: string;
}) {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);

  const loadMockHistory = useCallback(async () => {
    setStatus("connecting");
    try {
      await createPortalTokenSource()();
      const historyPage = await fetchMockHistoryPage(channel.slug);
      setMessages(historyPage.messages);
      setHasPrevious(historyPage.hasPrevious);
      setStatus("ready");
    } catch {
      setMessages([]);
      setHasPrevious(false);
      setStatus("reconnecting");
    }
  }, [channel.slug]);

  useEffect(() => {
    void loadMockHistory();
  }, [loadMockHistory]);

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
      active={active}
      channel={channel}
      displayName={displayName}
      hasPrevious={hasPrevious}
      identityId={identityId}
      isLoadingPrevious={isLoadingPrevious}
      loadPrevious={loadPrevious}
      messages={messages}
      onReact={onReact}
      onRetryConnection={() => void loadMockHistory()}
      onSend={sendMessage}
      reactionEvents={reactionEvents}
      reactionsEnabled={reactionsEnabled}
      status={status}
    />
  );
}

function MockPortalOffice(props: Omit<MockPortalOfficeProps, "mode">) {
  const {
    channels,
    identityId,
    displayName,
    employeeRecord,
    eventChannelId,
    jobTitle,
    isOperator,
    canSignOut,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");
  const [reactionEvents, setReactionEvents] = useState<ReactionOfficeEvent[]>(
    [],
  );
  const [reactionStatus, setReactionStatus] =
    useState<ChatConnectionStatus>("connecting");

  useEffect(() => {
    let cancelled = false;
    async function loadReactionHistory(): Promise<void> {
      try {
        const events = await fetchMockOfficeEvents(eventChannelId);
        if (!cancelled) {
          setReactionEvents(events);
          setReactionStatus("ready");
        }
      } catch {
        if (!cancelled) {
          setReactionEvents([]);
          setReactionStatus("reconnecting");
        }
      }
    }
    void loadReactionHistory();
    return () => {
      cancelled = true;
    };
  }, [eventChannelId]);

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
      isOperator={isOperator}
      jobTitle={jobTitle}
      onSelectChannel={setActiveChannelId}
      unreadCounts={{}}
    >
      {channels.map((channel) => (
        <MockOfficeChannel
          active={channel.id === activeChannelId}
          channel={channel}
          displayName={displayName}
          identityId={identityId}
          key={channel.id}
          onReact={updateReaction}
          reactionEvents={reactionEvents}
          reactionsEnabled={reactionStatus === "ready"}
        />
      ))}
    </OfficeWorkspace>
  );
}

export function PortalChat(props: PortalChatProps): ReactNode {
  return props.mode === "live" ? (
    <LivePortalOffice {...props} />
  ) : (
    <MockPortalOffice {...props} />
  );
}
