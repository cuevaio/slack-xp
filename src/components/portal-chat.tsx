"use client";

import type { AggregatePresence, DetailedPresence } from "@portalsdk/core";
import { Portal } from "@portalsdk/core";
import { PortalProvider, useChannel } from "@portalsdk/react";
import { useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
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
import type { OfficeInvalidationEvent } from "@/lib/office-events/contract";
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
  invalidateProfileBatches,
  useProfileBatch,
} from "@/lib/profiles/client";
import { ProfileQueryProvider } from "@/lib/profiles/provider";
import type { ProfileAttribution } from "@/lib/profiles/types";

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
  imageUrl: string | null;
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
  active: boolean;
  channel: OfficeChannel;
  presence?: DetailedPresence | AggregatePresence;
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
  | "identityId"
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

const FALLBACK_PROFILE_NAME = "New Hire";

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

function MessageHistory({
  channel,
  messages,
  profilesById,
}: {
  channel: OfficeChannel;
  messages: readonly SafePortalChatMessage[];
  profilesById: ReadonlyMap<string, ProfileAttribution>;
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
      {messages.map((message) => {
        const profile = profilesById.get(message.senderId);
        return (
          <li
            className={`chat-message chat-message-${message.status}`}
            key={message.id}
          >
            <div className="message-meta">
              <ProfileAvatar
                imageClassName="message-avatar"
                placeholderClassName="message-avatar-placeholder"
                profile={profile}
                size={28}
              />
              <strong>{profileDisplayName(profile)}</strong>
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
              <small role="alert">
                Not delivered. Retry from the composer.
              </small>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function PresenceRoster({
  presence,
  profilesById,
}: {
  presence: DetailedPresence | AggregatePresence | undefined;
  profilesById: ReadonlyMap<string, ProfileAttribution>;
}) {
  if (!presence) {
    return null;
  }
  if (presence.kind === "aggregate") {
    return (
      <p className="presence-summary">{presence.count} New Hires online</p>
    );
  }
  return (
    <div className="presence-summary">
      <strong>Online:</strong>
      {presence.participants.length === 0 ? (
        <span>Nobody</span>
      ) : (
        <ul aria-label="New Hires online">
          {presence.participants.map(({ id }) => {
            const profile = profilesById.get(id);
            return (
              <li key={id}>
                <ProfileAvatar
                  placeholderClassName="presence-avatar-placeholder"
                  profile={profile}
                  size={22}
                />
                <span>{profileDisplayName(profile)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChatSurface({
  active,
  channel,
  presence,
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
  const profileIds = useMemo(() => {
    const ids = messages.map(({ senderId }) => senderId);
    if (presence?.kind === "detailed") {
      ids.push(...presence.participants.map(({ id }) => id));
    }
    return ids;
  }, [messages, presence]);
  const profileQuery = useProfileBatch(profileIds);
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
  if (profileQuery.isError) {
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
        messages={messages}
        profilesById={profilesById}
      />
    );
  }

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
      <PresenceRoster presence={presence} profilesById={profilesById} />

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
  identityId,
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
  const currentProfile = useProfileBatch([identityId]);
  const currentDisplayName =
    currentProfile.data?.find((profile) => profile.clerkUserId === identityId)
      ?.displayName ?? displayName;
  return (
    <div className="office-body">
      <aside className="channel-panel" aria-label="Office Channels">
        <p className="eyebrow">Shared Public Office</p>
        <h1>Welcome, {currentDisplayName}</h1>
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
  onUnread,
}: {
  active: boolean;
  channel: OfficeChannel;
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
      hasPrevious={channel.hasPrevious}
      isLoadingPrevious={channel.isLoadingPrevious}
      loadPrevious={channel.loadPrevious}
      messages={channel.messages}
      onRetryConnection={() => window.location.reload()}
      onSend={async (text) => {
        await channel.send({ content: validateChatDraft(text) });
      }}
      presence={channel.presence}
      status={channel.status}
    />
  );
}

function ignoreOfficeEvent(): void {}

function OfficeEventAttentionGuard({ channelId }: { channelId: string }) {
  const queryClient = useQueryClient();
  const handleInvalidation = useCallback(
    (event: OfficeInvalidationEvent) => {
      if (event.type === "profile.invalidated") {
        void invalidateProfileBatches(queryClient, event.profileId);
      }
    },
    [queryClient],
  );
  useOfficeEventSubscription({
    channelId,
    onReaction: ignoreOfficeEvent,
    onInvalidation: handleInvalidation,
  });
  return null;
}

function LivePortalOffice(props: Omit<LivePortalOfficeProps, "mode">) {
  const {
    channels,
    identityId,
    displayName,
    employeeRecord,
    eventChannelId,
    jobTitle,
    isOperator,
    canSignOut,
    publishableKey,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [portal] = useState(
    () =>
      new Portal({
        apiKey: publishableKey,
        token: createPortalTokenSource(),
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
        identityId={identityId}
        isOperator={isOperator}
        jobTitle={jobTitle}
        onSelectChannel={setActiveChannelId}
        unreadCounts={unreadCounts}
      >
        {channels.map((channel) => (
          <LiveOfficeChannel
            active={channel.id === activeChannelId}
            channel={channel}
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
}: {
  active: boolean;
  channel: OfficeChannel;
  identityId: string;
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
      hasPrevious={hasPrevious}
      isLoadingPrevious={isLoadingPrevious}
      loadPrevious={loadPrevious}
      messages={messages}
      onRetryConnection={() => void loadMockHistory()}
      onSend={sendMessage}
      presence={{
        kind: "detailed",
        count: 1,
        participants: [{ id: identityId, anon: false }],
      }}
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
    jobTitle,
    isOperator,
    canSignOut,
  } = props;
  const [activeChannelId, setActiveChannelId] = useState(channels[0]?.id ?? "");

  return (
    <OfficeWorkspace
      activeChannelId={activeChannelId}
      canSignOut={canSignOut}
      channels={channels}
      displayName={displayName}
      employeeRecord={employeeRecord}
      identityId={identityId}
      isOperator={isOperator}
      jobTitle={jobTitle}
      onSelectChannel={setActiveChannelId}
      unreadCounts={{}}
    >
      {channels.map((channel) => (
        <MockOfficeChannel
          active={channel.id === activeChannelId}
          channel={channel}
          identityId={identityId}
          key={channel.id}
        />
      ))}
    </OfficeWorkspace>
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
      {props.mode === "live" ? (
        <LivePortalOffice {...props} />
      ) : (
        <MockPortalOffice {...props} />
      )}
    </ProfileQueryProvider>
  );
}
