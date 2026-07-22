"use client";

import { type InboxStatus, Portal } from "@portalsdk/core";
import { PortalProvider, useChannel, useInbox } from "@portalsdk/react";
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
import {
  type OfficeInboxEntry,
  type OfficeInboxRow,
  parseOfficeInboxResponse,
  reconcileOfficeInbox,
} from "@/lib/portal/inbox";

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

type ChatSurfaceProps = {
  visible: boolean;
  readWhenVisible?: boolean;
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
  onContentVisible?(): void;
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
      const nextEntries = parseOfficeInboxResponse(payload);
      if (!response.ok || !nextEntries) {
        throw new Error("Mock Portal inbox unavailable");
      }
      setEntries(nextEntries);
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
          data-message-id={message.id}
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
        </li>
      ))}
    </ol>
  );
}

function isChatContentReady(status: ChatConnectionStatus): boolean {
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
  displayName,
  messages: rawMessages,
  status,
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
  const latestMessageId = messages.at(-1)?.id ?? null;

  useEffect(() => {
    latestOnContentVisible.current = onContentVisible;
  }, [onContentVisible]);

  useEffect(() => {
    if (!visible || !readWhenVisible || !isChatContentReady(status)) {
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
  }, [latestMessageId, messages.length, readWhenVisible, status, visible]);

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
  inboxRows,
  inboxStatus,
  isMobile,
  mobileNavigationOpen,
  onOpenMobileNavigation,
  onSelectChannel,
  children,
}: OfficeWorkspaceProps) {
  const directoryButtons = useRef(new Map<string, HTMLButtonElement>());
  const mobileDirectoryTrigger = useRef<HTMLButtonElement>(null);
  const inboxRowsByChannelId = new Map(
    inboxRows.map((row) => [row.channelId, row]),
  );
  const totalUnread = inboxRows.reduce((total, row) => total + row.unread, 0);

  useEffect(() => {
    if (isMobile !== true) return;
    if (mobileNavigationOpen) {
      directoryButtons.current.get(activeChannelId)?.focus();
    } else {
      mobileDirectoryTrigger.current?.focus();
    }
  }, [activeChannelId, isMobile, mobileNavigationOpen]);

  return (
    <>
      <div
        className="office-body"
        data-mobile-view={mobileNavigationOpen ? "directory" : "conversation"}
      >
        <aside className="channel-panel" aria-label="Office Channels">
          <p className="eyebrow">Shared Public Office</p>
          <h1>Welcome, {displayName}</h1>
          <p className="job-title">{jobTitle}</p>
          {isOperator ? (
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
                    <small>{channel.name}</small>
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
    </>
  );
}

function LiveOfficeChannel({
  visible,
  channel: officeChannel,
  identityId,
  displayName,
  onInboxRead,
}: {
  visible: boolean;
  channel: OfficeChannel;
  identityId: string;
  displayName: string;
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
      displayName={displayName}
      hasPrevious={channel.hasPrevious}
      identityId={identityId}
      isLoadingPrevious={channel.isLoadingPrevious}
      loadPrevious={channel.loadPrevious}
      messages={channel.messages}
      onRetryConnection={() => window.location.reload()}
      onContentVisible={markVisibleContentRead}
      onSend={async (text) => {
        await channel.send({ content: validateChatDraft(text) });
      }}
      status={channel.status}
      visible={visible}
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

function LivePortalWorkspace(props: Omit<LivePortalOfficeProps, "mode">) {
  const {
    channels,
    identityId,
    displayName,
    employeeRecord,
    jobTitle,
    isOperator,
    canSignOut,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");
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
    [navigation.showConversation],
  );

  return (
    <OfficeWorkspace
      activeChannelId={activeChannelId}
      canSignOut={canSignOut}
      channels={channels}
      displayName={displayName}
      employeeRecord={employeeRecord}
      inboxRows={inboxRows}
      inboxStatus={inbox.status}
      isMobile={navigation.isMobile}
      isOperator={isOperator}
      jobTitle={jobTitle}
      mobileNavigationOpen={navigation.mobileNavigationOpen}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
    >
      {channels.map((channel) => (
        <LiveOfficeChannel
          channel={channel}
          displayName={displayName}
          identityId={identityId}
          key={channel.id}
          onInboxRead={markInboxRead}
          visible={
            navigation.conversationVisible && channel.id === activeChannelId
          }
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
      <OfficeEventAttentionGuard channelId={props.eventChannelId} />
      <LivePortalWorkspace {...props} />
    </PortalProvider>
  );
}

function MockOfficeChannel({
  visible,
  channel,
  identityId,
  displayName,
  latestActivityAt,
  onContentVisible,
}: {
  visible: boolean;
  channel: OfficeChannel;
  identityId: string;
  displayName: string;
  latestActivityAt: number;
  onContentVisible(channelId: string): void;
}) {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoadingPrevious, setIsLoadingPrevious] = useState(false);
  const [readWhenVisible, setReadWhenVisible] = useState(false);

  const loadMockHistory = useCallback(async (): Promise<boolean> => {
    setStatus("connecting");
    try {
      await createPortalTokenSource()();
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
  }, [channel.slug]);

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
      displayName={displayName}
      hasPrevious={hasPrevious}
      identityId={identityId}
      isLoadingPrevious={isLoadingPrevious}
      loadPrevious={loadPrevious}
      messages={messages}
      onContentVisible={() => onContentVisible(channel.id)}
      onRetryConnection={() => {
        setReadWhenVisible(false);
        void loadMockHistory().then(setReadWhenVisible);
      }}
      onSend={sendMessage}
      readWhenVisible={readWhenVisible}
      status={status}
      visible={visible}
    />
  );
}

function MockPortalOffice(props: Omit<MockPortalOfficeProps, "mode">) {
  const {
    channels,
    identityId,
    displayName,
    employeeRecord,
    jobTitle,
    isOperator,
    canSignOut,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");
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
    [navigation.showConversation],
  );
  const markInboxRead = useCallback(
    (channelId: string) => void inbox.markAsRead(channelId),
    [inbox.markAsRead],
  );

  return (
    <OfficeWorkspace
      activeChannelId={activeChannelId}
      canSignOut={canSignOut}
      channels={channels}
      displayName={displayName}
      employeeRecord={employeeRecord}
      inboxRows={inboxRows}
      inboxStatus={inbox.status}
      isMobile={navigation.isMobile}
      isOperator={isOperator}
      jobTitle={jobTitle}
      mobileNavigationOpen={navigation.mobileNavigationOpen}
      onOpenMobileNavigation={navigation.openMobileNavigation}
      onSelectChannel={selectChannel}
    >
      {channels.map((channel) => (
        <MockOfficeChannel
          channel={channel}
          displayName={displayName}
          identityId={identityId}
          key={channel.id}
          latestActivityAt={
            inboxRowsByChannelId.get(channel.id)?.preview?.at ?? 0
          }
          onContentVisible={markInboxRead}
          visible={
            navigation.conversationVisible && channel.id === activeChannelId
          }
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
