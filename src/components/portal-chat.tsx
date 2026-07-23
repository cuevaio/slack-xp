"use client";

import { useAuth } from "@clerk/nextjs";
import { type Message, Portal } from "@portalsdk/core";
import { PortalProvider, useChannel, useInbox } from "@portalsdk/react";
import { useState } from "react";
import {
  listOfficeChannels,
  type OfficeChannel,
  type OfficeChannelSlug,
} from "@/lib/portal/channels";
import { createPortalTokenSource } from "@/lib/portal/client";

type ChatContent = { text: string };

type SendChatMessage = (input: { content: ChatContent }) => Promise<unknown>;

export async function sendChatMessage(send: SendChatMessage, draft: string) {
  const text = draft.trim();
  if (!text) return false;
  await send({ content: { text } });
  return true;
}

export function readChannel(
  markChannelRead: () => void,
  inboxEntry: { markAsRead(): void } | undefined,
) {
  markChannelRead();
  inboxEntry?.markAsRead();
}

function messageText(message: Message<ChatContent>) {
  return !message.retracted && typeof message.content?.text === "string"
    ? message.content.text
    : null;
}

function ChannelDirectory({
  active,
  onSelect,
}: {
  active: OfficeChannelSlug;
  onSelect(channel: OfficeChannelSlug): void;
}) {
  const inbox = useInbox();
  return (
    <nav className="channel-list" aria-label="Office Channels">
      {listOfficeChannels().map((channel) => {
        const unread = inbox.channels.get(channel.id)?.unread ?? 0;
        return (
          <button
            className="channel-button"
            data-active={channel.id === active}
            key={channel.id}
            onClick={() => onSelect(channel.id)}
            type="button"
          >
            <span># {channel.name}</span>
            {unread > 0 ? <strong>{unread}</strong> : null}
          </button>
        );
      })}
    </nav>
  );
}

function LiveChannel({ channel }: { channel: OfficeChannel }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const live = useChannel<ChatContent>({
    channelId: channel.id,
    history: 50,
    readOn: "manual",
    onError: () => setError("Connection lost. Portal will keep retrying."),
  });
  const inbox = useInbox();
  const participants = live.presence?.count ?? 0;

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    setError(null);
    try {
      await sendChatMessage(live.send, text);
    } catch {
      setDraft(text);
      setError("Message not sent. Try again.");
    }
  }

  return (
    <section className="chat-panel" aria-labelledby="channel-title">
      <header className="chat-header">
        <div>
          <h1 id="channel-title"># {channel.name}</h1>
          <p>{channel.purpose}</p>
        </div>
        <span>
          {live.status === "ready" ? `${participants} online` : live.status}
        </span>
        {live.unread > 0 ? (
          <button
            onClick={() =>
              readChannel(live.markAsRead, inbox.channels.get(channel.id))
            }
            type="button"
          >
            Mark {live.unread} read
          </button>
        ) : null}
      </header>
      <div className="message-list">
        {live.hasPrevious ? (
          <button
            disabled={live.isLoadingPrevious}
            onClick={live.loadPrevious}
            type="button"
          >
            {live.isLoadingPrevious ? "Loading..." : "Load earlier messages"}
          </button>
        ) : null}
        {live.messages.map((message) => {
          const text = messageText(message);
          return text ? (
            <article className="message-row" key={message.id}>
              <strong>{message.sender.username ?? "New Hire"}</strong>
              <p>{text}</p>
            </article>
          ) : null;
        })}
        {live.typing.length > 0 ? (
          <p className="typing-status">Someone is typing...</p>
        ) : null}
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <form
        className="message-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label={`Message #${channel.name}`}
          maxLength={1000}
          onChange={(event) => {
            setDraft(event.target.value);
            live.sendTyping();
          }}
          value={draft}
        />
        <button
          disabled={live.status !== "ready" || !draft.trim()}
          type="submit"
        >
          Send
        </button>
      </form>
    </section>
  );
}

function Messenger() {
  const [activeId, setActiveId] = useState<OfficeChannelSlug>("general");
  const active =
    listOfficeChannels().find(({ id }) => id === activeId) ??
    listOfficeChannels()[0];
  return (
    <div className="messenger-layout">
      <ChannelDirectory active={activeId} onSelect={setActiveId} />
      <LiveChannel channel={active} />
    </div>
  );
}

export function PortalChat({ publishableKey }: { publishableKey: string }) {
  const { getToken } = useAuth();
  const [portal] = useState(() => new Portal({ apiKey: publishableKey }));
  const [token] = useState(() =>
    createPortalTokenSource({ getAuthorizationToken: () => getToken() }),
  );
  return (
    <PortalProvider client={portal} token={token}>
      <Messenger />
    </PortalProvider>
  );
}

export { messageText };
