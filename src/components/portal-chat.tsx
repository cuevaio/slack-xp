"use client";

import { Portal } from "@portalsdk/core";
import { PortalProvider, useChannel } from "@portalsdk/react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useOfficeEventSubscription } from "@/lib/office-events/client";
import { officeEventChannelIdForDay } from "@/lib/office-events/contract";
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
  formatOfficeTimestamp,
  observeOfficeDayBoundary,
  officeDay,
} from "@/lib/portal/office-day";

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

type OfficeDayWorkspace = Pick<
  PortalOfficeBaseProps,
  "channels" | "eventChannelId" | "officeDay"
>;

type ChatSurfaceProps = {
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

function MessageHistory({
  channel,
  messages,
  identityId,
  displayName,
}: {
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
              {formatOfficeTimestamp(message.timestamp)}
            </time>
          </div>
          <p>
            <SafeMessageText text={message.content.text} />
          </p>
          {message.status === "pending" ? <small>Sending…</small> : null}
          {message.status === "failed" ? (
            <small role="alert">Not delivered. Retry from the composer.</small>
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
}: {
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
      onRetryConnection={() => window.location.reload()}
      onSend={async (text) => {
        await channel.send({ content: validateChatDraft(text) });
      }}
      status={channel.status}
    />
  );
}

function ignoreOfficeEvent(): void {}

function OfficeEventAttentionGuard({ channelId }: { channelId: string }) {
  useOfficeEventSubscription({
    channelId,
    onReaction: ignoreOfficeEvent,
    onInvalidation: ignoreOfficeEvent,
  });
  return null;
}

function LivePortalOffice(
  props: Omit<LivePortalOfficeProps, "mode"> & {
    onOfficeDayExpired(): void;
  },
) {
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
    publishableKey,
    onOfficeDayExpired,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
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
  const updateUnread = useCallback((channelId: string, count: number) => {
    setUnreadCounts((current) => {
      if (current[channelId] === count) {
        return current;
      }
      return { ...current, [channelId]: count };
    });
  }, []);

  return (
    <PortalProvider client={portal}>
      <OfficeEventAttentionGuard channelId={eventChannelId} />
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
            onUnread={updateUnread}
          />
        ))}
      </OfficeWorkspace>
    </PortalProvider>
  );
}

function MockOfficeChannel({
  active,
  channel,
  identityId,
  displayName,
  officeDay: currentOfficeDay,
  onOfficeDayExpired,
}: {
  active: boolean;
  channel: OfficeChannel;
  identityId: string;
  displayName: string;
  officeDay: string;
  onOfficeDayExpired(): void;
}) {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);

  const loadMockHistory = useCallback(async () => {
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
    } catch {
      setMessages([]);
      setHasPrevious(false);
      setStatus("reconnecting");
    }
  }, [channel.slug, currentOfficeDay, onOfficeDayExpired]);

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
      onRetryConnection={() => void loadMockHistory()}
      onSend={sendMessage}
      status={status}
    />
  );
}

function MockPortalOffice(
  props: Omit<MockPortalOfficeProps, "mode"> & {
    onOfficeDayExpired(): void;
  },
) {
  const {
    channels,
    identityId,
    displayName,
    employeeRecord,
    jobTitle,
    isOperator,
    canSignOut,
    officeDay: currentOfficeDay,
    onOfficeDayExpired,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");

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
          officeDay={currentOfficeDay}
          onOfficeDayExpired={onOfficeDayExpired}
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

function createOfficeDayWorkspace(
  currentOfficeDay: string,
): OfficeDayWorkspace {
  return {
    channels: listOfficeChannelsForDay(currentOfficeDay),
    eventChannelId: officeEventChannelIdForDay(currentOfficeDay),
    officeDay: currentOfficeDay,
  };
}

export function PortalChat(props: PortalChatProps): ReactNode {
  const [workspace, setWorkspace] = useState<OfficeDayWorkspace>(() => ({
    channels: props.channels,
    eventChannelId: props.eventChannelId,
    officeDay: props.officeDay,
  }));
  const [endedOfficeDay, setEndedOfficeDay] = useState<string | null>(null);
  const [focusNewOffice, setFocusNewOffice] = useState(false);

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
    const frame = requestAnimationFrame(() => {
      const firstChannelId = workspace.channels[0]?.id;
      if (firstChannelId) {
        document.getElementById(`message-${firstChannelId}`)?.focus();
      }
      setFocusNewOffice(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [endedOfficeDay, focusNewOffice, workspace.channels]);

  function continueToCurrentOfficeDay(): void {
    setWorkspace(createOfficeDayWorkspace(officeDay()));
    setEndedOfficeDay(null);
    setFocusNewOffice(true);
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
