"use client";

import { Portal } from "@portalsdk/core";
import { PortalProvider, useChannel } from "@portalsdk/react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  CHAT_TEXT_LIMIT,
  linkifyChatText,
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

type PortalChatProps = {
  channelId: string;
  identityId: string;
  displayName: string;
} & (
  | { mode: "mock"; publishableKey?: never }
  | { mode: "live"; publishableKey: string }
);

function statusCopy(status: ChatConnectionStatus): string {
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
  messages,
  identityId,
  displayName,
}: {
  messages: readonly SafePortalChatMessage[];
  identityId: string;
  displayName: string;
}) {
  if (messages.length === 0) {
    return (
      <div className="empty-chat">
        <strong>The General Office Channel is quiet.</strong>
        <p>
          Start today&apos;s paper trail. Confirmed messages survive reconnects.
        </p>
      </div>
    );
  }

  return (
    <ol className="message-history" aria-label="General message history">
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
        </li>
      ))}
    </ol>
  );
}

function ChatSurface({
  channelId,
  identityId,
  displayName,
  messages: rawMessages,
  status,
  onSend,
  onRetryConnection,
  loadPrevious,
  hasPrevious = false,
  isLoadingPrevious = false,
}: {
  channelId: string;
  identityId: string;
  displayName: string;
  messages: readonly unknown[];
  status: ChatConnectionStatus;
  onSend(text: string): Promise<void>;
  onRetryConnection(): void;
  loadPrevious?: () => Promise<unknown>;
  hasPrevious?: boolean;
  isLoadingPrevious?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const messages = useMemo(
    () =>
      rawMessages
        .map(parsePortalChatMessage)
        .filter(
          (message): message is SafePortalChatMessage => message !== null,
        ),
    [rawMessages],
  );
  const invalidMessageCount = rawMessages.length - messages.length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSendError(null);
    let content: { text: string };
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

  const canPublish =
    status === "ready" || status === "degraded" || status === "degraded-http";

  return (
    <section className="general-chat" aria-labelledby="general-channel-heading">
      <header className="conversation-heading">
        <div>
          <span
            className={`presence-dot connection-${status}`}
            aria-hidden="true"
          />
          <strong id="general-channel-heading"># General</strong>
          <span className="channel-purpose">Company-wide conversation</span>
        </div>
        <output className="connection-status" aria-live="polite">
          {statusCopy(status)}
        </output>
      </header>

      <div className="chat-scroll-region">
        {hasPrevious && loadPrevious ? (
          <button
            className="classic-button load-history-button"
            disabled={isLoadingPrevious}
            onClick={() => void loadPrevious()}
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
          displayName={displayName}
          identityId={identityId}
          messages={messages}
        />
      </div>

      <form className="chat-composer" onSubmit={submit}>
        <label htmlFor={`message-${channelId}`}>Message # General</label>
        <textarea
          disabled={!canPublish}
          id={`message-${channelId}`}
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
            {isSending ? "Sending…" : sendError ? "Retry send" : "Send"}
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

function LiveGeneralChat({
  channelId,
  identityId,
  displayName,
  publishableKey,
}: Omit<PortalChatProps, "mode"> & { publishableKey: string }) {
  const [portal] = useState(
    () =>
      new Portal({
        apiKey: publishableKey,
        token: createPortalTokenSource(),
      }),
  );

  return (
    <PortalProvider client={portal}>
      <LiveChannel
        channelId={channelId}
        displayName={displayName}
        identityId={identityId}
      />
    </PortalProvider>
  );
}

function LiveChannel({
  channelId,
  identityId,
  displayName,
}: {
  channelId: string;
  identityId: string;
  displayName: string;
}) {
  const channel = useChannel<{ text: string }>({
    channelId,
    history: 50,
    readOn: "visible",
  });

  return (
    <ChatSurface
      channelId={channelId}
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

function MockGeneralChat({
  channelId,
  identityId,
  displayName,
}: Omit<PortalChatProps, "mode">) {
  const [messages, setMessages] = useState<unknown[]>([]);
  const [status, setStatus] = useState<ChatConnectionStatus>("connecting");

  const loadHistory = useCallback(async () => {
    setStatus("connecting");
    try {
      await createPortalTokenSource()();
      const response = await fetch("/api/office/portal/mock-chat", {
        credentials: "include",
        cache: "no-store",
      });
      const payload: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        typeof payload !== "object" ||
        payload === null ||
        !("messages" in payload) ||
        !Array.isArray(payload.messages)
      ) {
        throw new Error("Mock Portal history unavailable");
      }
      setMessages(payload.messages);
      setStatus("ready");
    } catch {
      setMessages([]);
      setStatus("reconnecting");
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  async function send(text: string): Promise<void> {
    const content = validateChatDraft(text);
    const temporaryId = `pending-${crypto.randomUUID()}`;
    const pending = {
      id: temporaryId,
      channelId,
      sender: { id: identityId, anon: false },
      timestamp: Date.now(),
      kind: "text",
      type: "message",
      ephemeral: false,
      retracted: false,
      status: "pending",
      content,
    };
    setMessages((current) => [...current, pending]);

    try {
      const response = await fetch("/api/office/portal/mock-chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
      const confirmed: unknown = await response.json().catch(() => null);
      if (!response.ok || !parsePortalChatMessage(confirmed)) {
        throw new Error("Mock Portal publish unavailable");
      }
      setMessages((current) =>
        current.map((message) =>
          typeof message === "object" &&
          message !== null &&
          "id" in message &&
          message.id === temporaryId
            ? confirmed
            : message,
        ),
      );
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          typeof message === "object" &&
          message !== null &&
          "id" in message &&
          message.id === temporaryId
            ? { ...pending, status: "failed" }
            : message,
        ),
      );
      throw error;
    }
  }

  return (
    <ChatSurface
      channelId={channelId}
      displayName={displayName}
      identityId={identityId}
      messages={messages}
      onRetryConnection={() => void loadHistory()}
      onSend={send}
      status={status}
    />
  );
}

export function PortalChat(props: PortalChatProps): ReactNode {
  return props.mode === "live" ? (
    <LiveGeneralChat {...props} />
  ) : (
    <MockGeneralChat {...props} />
  );
}
