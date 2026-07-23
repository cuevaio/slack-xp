"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
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
type Profile = { id: string; name: string; imageUrl: string | null };
type SendChatMessage = (input: { content: ChatContent }) => Promise<unknown>;

export function messageText(message: Message<ChatContent>) {
  return !message.retracted && typeof message.content?.text === "string"
    ? message.content.text
    : null;
}

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

function Avatar({
  profile,
  active = false,
}: {
  profile: Profile;
  active?: boolean;
}) {
  return (
    <span className="message-avatar-wrap">
      {profile.imageUrl ? (
        // Clerk controls this authenticated profile URL.
        // biome-ignore lint/performance/noImgElement: arbitrary Clerk image hosts are expected.
        <img alt="" className="message-avatar" src={profile.imageUrl} />
      ) : (
        <span className="message-avatar-placeholder">
          {profile.name.slice(0, 1)}
        </span>
      )}
      <span
        aria-hidden="true"
        className="participant-activity-dot"
        data-active={active}
      />
    </span>
  );
}

function AccountMenu({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false);
  const { openUserProfile, signOut } = useClerk();
  return (
    <div className="employee-record-control">
      {open ? (
        <div className="employee-record-menu" role="menu">
          <button
            onClick={() => {
              setOpen(false);
              openUserProfile();
            }}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true">[edit]</span> Edit profile
          </button>
          <hr />
          <button
            onClick={() => void signOut({ redirectUrl: "/" })}
            role="menuitem"
            type="button"
          >
            <span aria-hidden="true">[exit]</span> Log out
          </button>
        </div>
      ) : null}
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="employee-record-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {profile.imageUrl ? (
          // biome-ignore lint/performance/noImgElement: arbitrary Clerk image hosts are expected.
          <img
            alt=""
            className="employee-record-avatar"
            src={profile.imageUrl}
          />
        ) : (
          <span className="employee-record-avatar-fallback">
            {profile.name.slice(0, 1)}
          </span>
        )}
        <span className="employee-record-name">{profile.name}</span>
        <span aria-hidden="true">^</span>
      </button>
    </div>
  );
}

function LiveChannel({
  channel,
  profile,
}: {
  channel: OfficeChannel;
  profile: Profile;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inbox = useInbox();
  const live = useChannel<ChatContent>({
    channelId: channel.id,
    history: 50,
    readOn: "manual",
    metadata: { username: profile.name, avatar: profile.imageUrl },
    onError: () => setError("Connection lost. Portal will keep retrying."),
  });
  const participants = live.presence?.count ?? 0;
  const activeProfiles = new Map<string, Profile>([[profile.id, profile]]);
  if (live.presence?.kind === "detailed") {
    for (const participant of live.presence.participants) {
      activeProfiles.set(participant.id, {
        id: participant.id,
        name:
          participant.username ??
          (typeof participant.metadata?.username === "string"
            ? participant.metadata.username
            : "New Hire"),
        imageUrl:
          typeof participant.metadata?.avatar === "string"
            ? participant.metadata.avatar
            : null,
      });
    }
  }

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
    <section
      className={`general-chat ${channel.mode === "broadcast" ? "broadcast-chat" : ""}`}
    >
      <header className="conversation-heading">
        <div>
          <span
            aria-hidden="true"
            className={`presence-dot connection-${live.status}`}
          />
          <strong># {channel.name}</strong>
          <span className="channel-purpose">{channel.purpose}</span>
        </div>
        <span className="connection-status">
          {live.status === "ready" ? `${participants} online` : live.status}
        </span>
      </header>

      <div className="conversation-content">
        <aside className="detailed-presence" aria-label="New Hires online">
          <strong>Online now</strong>
          {activeProfiles.size > 0 ? (
            <ul>
              {[...activeProfiles.values()].map((participant) => (
                <li key={participant.id}>
                  <Avatar active profile={participant} />
                  <span>{participant.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <small>No one else is online.</small>
          )}
        </aside>
        <div className="chat-scroll-region">
          {live.hasPrevious ? (
            <button
              className="load-history-button"
              disabled={live.isLoadingPrevious}
              onClick={live.loadPrevious}
              type="button"
            >
              {live.isLoadingPrevious ? "Loading..." : "Load earlier messages"}
            </button>
          ) : null}
          <ol
            className="message-history"
            aria-label={`${channel.name} message history`}
          >
            {live.messages.map((message) => {
              const text = messageText(message);
              if (!text) return null;
              const sender =
                activeProfiles.get(message.sender.id) ??
                ({
                  id: message.sender.id,
                  name: message.sender.username ?? "New Hire",
                  imageUrl: null,
                } satisfies Profile);
              return (
                <li
                  className={`chat-message chat-message-${message.status}`}
                  key={message.id}
                >
                  <div className="message-meta">
                    <span className="profile-context-trigger">
                      <Avatar
                        active={activeProfiles.has(sender.id)}
                        profile={sender}
                      />
                      <strong>{sender.name}</strong>
                      <time
                        dateTime={new Date(message.timestamp).toISOString()}
                      >
                        {new Date(message.timestamp).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </span>
                  </div>
                  <p>{text}</p>
                </li>
              );
            })}
          </ol>
          {live.typing.length > 0 ? (
            <p className="typing-status">Someone is typing...</p>
          ) : null}
        </div>
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="composer-input-shell">
          <textarea
            aria-label={`Message #${channel.name}`}
            disabled={live.status !== "ready"}
            maxLength={1000}
            onChange={(event) => {
              setDraft(event.target.value);
              if (channel.mode === "standard" && event.target.value.trim())
                live.sendTyping();
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={
              live.status === "ready" ? "Type a message..." : "Reconnecting..."
            }
            rows={2}
            value={draft}
          />
          <div className="composer-actions">
            <span className="character-count">{draft.length} / 1,000</span>
            <button
              className="send-message-button"
              disabled={live.status !== "ready" || !draft.trim()}
              type="submit"
            >
              {error ? "Retry send" : "Send"}
            </button>
          </div>
        </div>
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
        {error ? (
          <p className="chat-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

function Messenger({ profile }: { profile: Profile }) {
  const [activeId, setActiveId] = useState<OfficeChannelSlug>("general");
  const inbox = useInbox();
  const channels = listOfficeChannels();
  const active = channels.find(({ id }) => id === activeId) ?? channels[0];
  return (
    <div className="office-body">
      <aside className="channel-panel">
        <h1>Portal Messenger</h1>
        <span className="job-title">Signed in as {profile.name}</span>
        <nav aria-label="Office Channels">
          {channels.map((channel) => {
            const unread = inbox.channels.get(channel.id)?.unread ?? 0;
            return (
              <button
                aria-current={channel.id === activeId ? "page" : undefined}
                className="channel-button"
                key={channel.id}
                onClick={() => setActiveId(channel.id)}
                type="button"
              >
                <span className="channel-button-copy">
                  <strong># {channel.name}</strong>
                  <small>{channel.purpose}</small>
                </span>
                {unread > 0 ? <b>{unread}</b> : null}
              </button>
            );
          })}
        </nav>
        <AccountMenu profile={profile} />
      </aside>
      <div className="conversation-panel">
        <LiveChannel channel={active} profile={profile} />
      </div>
    </div>
  );
}

export function PortalChat({
  profile,
  publishableKey,
}: {
  profile: Profile;
  publishableKey: string;
}) {
  const { getToken } = useAuth();
  const [portal] = useState(() => new Portal({ apiKey: publishableKey }));
  const [token] = useState(() =>
    createPortalTokenSource({ getAuthorizationToken: () => getToken() }),
  );
  return (
    <PortalProvider client={portal} token={token}>
      <Messenger profile={profile} />
    </PortalProvider>
  );
}
