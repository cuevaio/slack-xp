"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import {
  type AggregatePresence,
  type DetailedPresence,
  type MemberRow,
  type Message,
  Portal,
} from "@portalsdk/core";
import { PortalProvider, useChannel, useInbox } from "@portalsdk/react";
import {
  type ReactNode,
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  type EmojiSuggestion,
  type EmojiTrigger,
  findEmojiTrigger,
  replaceEmojiShortcodes,
  searchEmojis,
} from "@/lib/emoji";
import {
  listOfficeChannels,
  type OfficeChannel,
  type OfficeChannelSlug,
} from "@/lib/portal/channels";
import { createPortalTokenSource } from "@/lib/portal/client";
import {
  createReactionToggle,
  projectReactions,
  REACTION_EVENT_TYPE,
  type Reaction,
  type ReactionToggleContent,
} from "@/lib/portal/reactions";

type MentionRange = { userId: string; start: number; length: number };
type ChatContent = { text: string; mentionRanges?: MentionRange[] };
type Profile = { id: string; name: string; imageUrl: string | null };
type DraftMention = { userId: string; label: string };
type SendChatMessage = (input: {
  content: ChatContent;
  mentions?: { userId: string }[];
}) => Promise<unknown>;
type PortalContent = ChatContent | ReactionToggleContent;
type ChannelPresence = DetailedPresence | AggregatePresence | undefined;

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
  return content;
}

const REACTION_OPTIONS: ReadonlyArray<{
  id: Reaction;
  label: string;
  emoji: string;
}> = [
  { id: "like", label: "Like", emoji: "👍" },
  { id: "love", label: "Love", emoji: "❤️" },
  { id: "laugh", label: "Laugh", emoji: "😂" },
  { id: "surprise", label: "Surprise", emoji: "😮" },
];
const MESSAGE_GROUP_WINDOW_MS = 5 * 60 * 1000;
const CHANNEL_HISTORY_SIZE = 50;

export function shouldGroupMessages(
  previous: Message<ChatContent> | undefined,
  current: Message<ChatContent>,
) {
  return (
    previous !== undefined &&
    messageText(previous) !== null &&
    previous.sender.id === current.sender.id &&
    current.timestamp >= previous.timestamp &&
    current.timestamp - previous.timestamp <= MESSAGE_GROUP_WINDOW_MS
  );
}

export function messageText(
  message: Pick<Message<unknown>, "content" | "retracted">,
) {
  const content = message.content;
  return !message.retracted &&
    typeof content === "object" &&
    content !== null &&
    "text" in content &&
    typeof content.text === "string"
    ? content.text
    : null;
}

export function isVisibleChatMessage(
  message: Message<unknown>,
): message is Message<ChatContent> {
  return message.type !== REACTION_EVENT_TYPE && messageText(message) !== null;
}

export function canReactToMessage(message: Pick<Message<unknown>, "status">) {
  return message.status === "sent";
}

export function createMentionedContent(
  draft: string,
  mentions: readonly DraftMention[],
) {
  const text = draft.trim();
  const mentionRanges: MentionRange[] = [];
  for (const mention of mentions) {
    const start = text.indexOf(mention.label);
    if (start === -1) continue;
    mentionRanges.push({
      userId: mention.userId,
      start,
      length: mention.label.length,
    });
  }
  mentionRanges.sort((left, right) => left.start - right.start);
  return mentionRanges.length > 0 ? { text, mentionRanges } : { text };
}

export async function sendChatMessage(
  send: SendChatMessage,
  draft: string,
  mentions: readonly DraftMention[] = [],
) {
  const content = createMentionedContent(draft, mentions);
  if (!content.text) return false;
  const mentionedUserIds = [
    ...new Set(content.mentionRanges?.map(({ userId }) => userId) ?? []),
  ];
  await send({
    content,
    ...(mentionedUserIds.length > 0
      ? { mentions: mentionedUserIds.map((userId) => ({ userId })) }
      : {}),
  });
  return true;
}

export function scrollToLatestSentMessage(input: {
  currentUserId: string;
  latestSenderId: string | undefined;
  pending: boolean;
  scrollRegion: { scrollHeight: number; scrollTop: number };
}) {
  if (!input.pending || input.latestSenderId !== input.currentUserId)
    return false;
  input.scrollRegion.scrollTop = input.scrollRegion.scrollHeight;
  return true;
}

export function readChannel(
  markChannelRead: () => void,
  inboxEntry: { markAsRead(): void } | undefined,
) {
  markChannelRead();
  inboxEntry?.markAsRead();
}

export function shouldMarkVisibleMessagesRead(input: {
  active: boolean;
  channelUnread: number;
  documentVisible: boolean;
  hasVisibleMessage: boolean;
  inboxAvailable: boolean;
  inboxUnread: number | undefined;
}) {
  const { active, documentVisible, hasVisibleMessage, inboxAvailable } = input;
  // Channel and inbox snapshots are delivered independently, so their counts
  // must be reconciled when either side still reports unread state.
  return (
    active &&
    documentVisible &&
    hasVisibleMessage &&
    inboxAvailable &&
    (input.channelUnread > 0 || (input.inboxUnread ?? 0) > 0)
  );
}

export function typingStatus(
  typing: readonly string[],
  profiles: ReadonlyMap<string, Pick<Profile, "name">>,
  currentUserId: string,
) {
  const names = typing
    .filter((id) => id !== currentUserId)
    .map((id) => profiles.get(id)?.name ?? "New Hire");
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is typing...`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)} are typing...`;
}

export function updateOfficeProfiles(
  current: ReadonlyMap<string, Profile>,
  profile: Profile,
  presence: ChannelPresence,
) {
  if (presence?.kind !== "detailed") return current;

  const profiles = new Map(current);
  profiles.set(profile.id, profile);
  for (const participant of presence.participants) {
    profiles.set(participant.id, {
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
  return profiles;
}

export function updateMemberProfiles(
  current: ReadonlyMap<string, Profile>,
  members: readonly MemberRow[],
) {
  const profiles = new Map(current);
  for (const member of members) {
    profiles.set(member.userId, {
      id: member.userId,
      name:
        typeof member.claims.username === "string"
          ? member.claims.username
          : "New Hire",
      imageUrl:
        typeof member.claims.avatar === "string" ? member.claims.avatar : null,
    });
  }
  return profiles;
}

function MessageText({
  content,
  currentUserId,
}: {
  content: ChatContent;
  currentUserId: string;
}) {
  const rendered: ReactNode[] = [];
  let cursor = 0;
  for (const range of content.mentionRanges ?? []) {
    const end = range.start + range.length;
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.length) ||
      range.start < cursor ||
      range.length < 1 ||
      end > content.text.length
    ) {
      continue;
    }
    rendered.push(content.text.slice(cursor, range.start));
    rendered.push(
      <span
        className="message-mention"
        data-current-new-hire={range.userId === currentUserId}
        key={`${range.userId}-${range.start}`}
      >
        {content.text.slice(range.start, end)}
      </span>,
    );
    cursor = end;
  }
  rendered.push(content.text.slice(cursor));
  return rendered;
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
  active,
  channel,
  officeProfiles,
  onlineProfileIds,
  onMembersChange,
  onPresenceChange,
  onMention,
  onReady,
  portal,
  profile,
}: {
  active: boolean;
  channel: OfficeChannel;
  officeProfiles: ReadonlyMap<string, Profile>;
  onlineProfileIds: ReadonlySet<string>;
  onMembersChange: (members: readonly MemberRow[]) => void;
  onPresenceChange: (presence: ChannelPresence) => void;
  onMention: (channelId: OfficeChannelSlug) => void;
  onReady: (channelId: OfficeChannelSlug) => void;
  portal: Portal;
  profile: Profile;
}) {
  const [draft, setDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<DraftMention[]>([]);
  const [mentionSearch, setMentionSearch] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [emojiSearch, setEmojiSearch] = useState<EmojiTrigger | null>(null);
  const [activeEmojiIndex, setActiveEmojiIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerOverlayRef = useRef<HTMLDivElement>(null);
  const scrollRegionRef = useRef<HTMLDivElement>(null);
  const scrollAfterSendRef = useRef(false);
  const inbox = useInbox();
  const live = useChannel<PortalContent>({
    channelId: channel.id,
    history: CHANNEL_HISTORY_SIZE,
    readOn: "manual",
    metadata: { username: profile.name, avatar: profile.imageUrl },
    onMention: () => onMention(channel.id),
    onError: () => setError("Connection lost. Portal will keep retrying."),
  });
  const reportReady = useEffectEvent(onReady);
  const reportMembers = useEffectEvent(onMembersChange);
  const reportPresence = useEffectEvent(onPresenceChange);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Effect Events are intentionally non-reactive.
  useEffect(() => {
    if (live.status === "ready") reportReady(channel.id);
  }, [channel.id, live.status]);
  // The standard channel supplies the detailed office roster. Broadcast presence is aggregate-only.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Effect Events are intentionally non-reactive.
  useEffect(() => {
    if (channel.mode === "standard") reportPresence(live.presence);
  }, [channel.mode, live.presence]);
  // Presence only contains connected users; the member directory resolves historical senders.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Effect Events are intentionally non-reactive.
  useEffect(() => {
    if (channel.mode !== "standard" || live.status !== "ready") return;
    void portal
      .channel(channel.id)
      .members()
      .then(reportMembers)
      .catch(() =>
        setError("Employee directory unavailable. Try reconnecting."),
      );
  }, [channel.id, channel.mode, live.status, portal]);
  const reactions = projectReactions(live.messages);
  const visibleMessages = live.messages.filter(isVisibleChatMessage);
  const mentionCandidates = mentionSearch
    ? [...officeProfiles.values()]
        .filter(({ id }) => id !== profile.id)
        .filter(({ name }) =>
          name
            .toLocaleLowerCase()
            .includes(mentionSearch.query.toLocaleLowerCase()),
        )
        .toSorted((left, right) => left.name.localeCompare(right.name))
        .slice(0, 6)
    : [];
  const activeMention = mentionCandidates[activeMentionIndex];
  const emojiCandidates = emojiSearch ? searchEmojis(emojiSearch.query) : [];
  const activeEmoji = emojiCandidates[activeEmojiIndex];
  const visibleMessageIds = visibleMessages.map(({ id }) => id).join("\0");
  const latestVisibleMessageId = visibleMessages.at(-1)?.id;
  const latestVisibleSenderId = visibleMessages.at(-1)?.sender.id;
  const inboxUnread = inbox.channels.get(channel.id)?.unread;
  const markVisibleMessagesRead = useEffectEvent(
    (hasVisibleMessage: boolean) => {
      const inboxEntry = inbox.channels.get(channel.id);
      if (
        !shouldMarkVisibleMessagesRead({
          active,
          channelUnread: live.unread,
          documentVisible: document.visibilityState === "visible",
          hasVisibleMessage,
          inboxAvailable: Boolean(inboxEntry),
          inboxUnread: inboxEntry?.unread,
        }) ||
        !inboxEntry
      )
        return;
      readChannel(live.markAsRead, inboxEntry);
    },
  );

  // Portal keeps channel and inbox read positions independently. A visible chat
  // reconciles both whenever either source still reports unread state.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Effect Events are intentionally non-reactive.
  useEffect(() => {
    const root = scrollRegionRef.current;
    if (!active || live.status !== "ready" || !visibleMessageIds || !root)
      return;
    const observedRoot = root;

    let frame = 0;
    function checkVisibility() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rootRect = observedRoot.getBoundingClientRect();
        const hasVisibleMessage = [
          ...observedRoot.querySelectorAll<HTMLElement>(".chat-message"),
        ].some((message) => {
          const messageRect = message.getBoundingClientRect();
          return (
            messageRect.right > rootRect.left &&
            messageRect.left < rootRect.right &&
            messageRect.bottom > rootRect.top &&
            messageRect.top < rootRect.bottom
          );
        });
        markVisibleMessagesRead(hasVisibleMessage);
      });
    }
    const resizeObserver = new ResizeObserver(checkVisibility);
    resizeObserver.observe(observedRoot);
    observedRoot.addEventListener("scroll", checkVisibility, { passive: true });
    window.addEventListener("resize", checkVisibility);
    document.addEventListener("visibilitychange", checkVisibility);
    checkVisibility();

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      observedRoot.removeEventListener("scroll", checkVisibility);
      window.removeEventListener("resize", checkVisibility);
      document.removeEventListener("visibilitychange", checkVisibility);
    };
  }, [active, inboxUnread, live.status, visibleMessageIds]);

  useEffect(() => {
    const root = scrollRegionRef.current;
    if (
      latestVisibleMessageId &&
      root &&
      scrollToLatestSentMessage({
        currentUserId: profile.id,
        latestSenderId: latestVisibleSenderId,
        pending: scrollAfterSendRef.current,
        scrollRegion: root,
      })
    ) {
      scrollAfterSendRef.current = false;
    }
  }, [latestVisibleMessageId, latestVisibleSenderId, profile.id]);

  function updateMentionSearch(
    text: string,
    cursor: number,
    previousText: string,
  ) {
    if (!mentionSearch) {
      const typedAt =
        text.length === previousText.length + 1 && text[cursor - 1] === "@";
      if (typedAt) {
        setActiveMentionIndex(0);
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
    setActiveMentionIndex(0);
  }

  function selectMention(selectedProfile: Profile) {
    if (!mentionSearch) return;
    const label = `@${selectedProfile.name}`;
    const nextDraft = `${draft.slice(0, mentionSearch.start)}${label} ${draft.slice(mentionSearch.end)}`;
    const cursor = mentionSearch.start + label.length + 1;
    setDraft(nextDraft);
    setDraftMentions((current) => [
      ...current.filter(({ userId }) => userId !== selectedProfile.id),
      { userId: selectedProfile.id, label },
    ]);
    setMentionSearch(null);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  function updateEmojiSearch(text: string, cursor: number) {
    const nextSearch = findEmojiTrigger(text, cursor);
    setEmojiSearch(nextSearch);
    setActiveEmojiIndex(0);
    if (nextSearch) setMentionSearch(null);
  }

  function selectEmoji(emoji: EmojiSuggestion) {
    if (!emojiSearch) return;
    const nextDraft = `${draft.slice(0, emojiSearch.start)}${emoji.unicode} ${draft.slice(emojiSearch.end)}`;
    const cursor = emojiSearch.start + emoji.unicode.length + 1;
    setDraft(nextDraft);
    setEmojiSearch(null);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const submittedMentions = draftMentions;
    setDraftMentions([]);
    setMentionSearch(null);
    setEmojiSearch(null);
    setError(null);
    scrollAfterSendRef.current = true;
    try {
      await sendChatMessage(live.send, text, submittedMentions);
    } catch {
      scrollAfterSendRef.current = false;
      setDraft(text);
      setDraftMentions(submittedMentions);
      setError("Message not sent. Try again.");
    }
  }

  async function toggleReaction(messageId: string, reaction: Reaction) {
    setError(null);
    try {
      await live.send(createReactionToggle(messageId, reaction));
    } catch {
      setError("Reaction not sent. Try again.");
    }
  }

  return (
    <section
      className={`general-chat ${channel.mode === "broadcast" ? "broadcast-chat" : ""}`}
      hidden={!active}
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
          {live.status === "ready"
            ? `${onlineProfileIds.size} online`
            : live.status}
        </span>
      </header>

      <div className="conversation-content">
        <aside
          className="live-activity-panel detailed-presence"
          aria-label="New Hires online"
        >
          <strong>Online now</strong>
          {onlineProfileIds.size > 0 ? (
            <ul>
              {[...officeProfiles.values()]
                .filter(({ id }) => onlineProfileIds.has(id))
                .map((participant) => (
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
        <div className="chat-scroll-region" ref={scrollRegionRef}>
          {live.hasPrevious ? (
            <button
              className="load-history-button"
              disabled={live.isLoadingPrevious}
              onClick={live.loadPrevious}
              type="button"
            >
              Load earlier messages
            </button>
          ) : null}
          <ol
            className="message-history"
            aria-label={`${channel.name} message history`}
          >
            {visibleMessages.map((message, index) => {
              const text = messageText(message);
              if (text === null) return null;
              const previousMessage = visibleMessages[index - 1];
              const groupedWithPrevious = shouldGroupMessages(
                previousMessage,
                message,
              );
              const sender =
                officeProfiles.get(message.sender.id) ??
                ({
                  id: message.sender.id,
                  name: message.sender.username ?? "New Hire",
                  imageUrl: null,
                } satisfies Profile);
              return (
                <li
                  className={`chat-message chat-message-${message.status}${groupedWithPrevious ? " chat-message-grouped" : ""}${message.mentions?.some(({ userId }) => userId === profile.id) ? " chat-message-mentioned" : ""}`}
                  key={message.id}
                >
                  {groupedWithPrevious ? null : (
                    <div className="message-meta">
                      <span className="profile-context-trigger">
                        <Avatar
                          active={onlineProfileIds.has(sender.id)}
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
                  )}
                  <p>
                    <MessageText
                      content={message.content}
                      currentUserId={profile.id}
                    />
                  </p>
                  <div className="message-reaction-summary">
                    {REACTION_OPTIONS.flatMap((reaction) => {
                      const users = reactions[message.id]?.[reaction.id] ?? [];
                      if (users.length === 0) return [];
                      const selected = users.includes(profile.id);
                      return [
                        <button
                          aria-label={`${reaction.label}, ${users.length}`}
                          aria-pressed={selected}
                          disabled={!canReactToMessage(message)}
                          key={reaction.id}
                          onClick={() => {
                            void toggleReaction(message.id, reaction.id);
                          }}
                          title={reaction.label}
                          type="button"
                        >
                          <span aria-hidden="true">{reaction.emoji}</span>
                          <span>{users.length}</span>
                        </button>,
                      ];
                    })}
                  </div>
                  <fieldset className="message-reaction-picker">
                    <legend className="sr-only">Add a reaction</legend>
                    {REACTION_OPTIONS.map((reaction) => (
                      <button
                        aria-label={reaction.label}
                        disabled={!canReactToMessage(message)}
                        key={reaction.id}
                        onClick={() => {
                          void toggleReaction(message.id, reaction.id);
                        }}
                        title={reaction.label}
                        type="button"
                      >
                        <span aria-hidden="true">{reaction.emoji}</span>
                      </button>
                    ))}
                  </fieldset>
                </li>
              );
            })}
          </ol>
          {typingStatus(live.typing, officeProfiles, profile.id) ? (
            <p className="typing-status">
              {typingStatus(live.typing, officeProfiles, profile.id)}
            </p>
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
          <div
            aria-hidden="true"
            className="composer-highlight-layer"
            ref={composerOverlayRef}
          >
            <DraftMentionOverlay mentions={draftMentions} text={draft} />
            {draft.endsWith("\n") ? "\n " : null}
          </div>
          <textarea
            aria-label={`Message #${channel.name}`}
            disabled={live.status !== "ready"}
            maxLength={1000}
            onChange={(event) => {
              const replacement = replaceEmojiShortcodes(
                event.target.value,
                event.target.selectionStart ?? event.target.value.length,
              );
              const nextDraft = replacement.text;
              setDraft(nextDraft);
              setDraftMentions((current) =>
                current.filter(({ label }) => nextDraft.includes(label)),
              );
              updateMentionSearch(nextDraft, replacement.cursor, draft);
              updateEmojiSearch(nextDraft, replacement.cursor);
              if (nextDraft !== event.target.value) {
                requestAnimationFrame(() => {
                  composerRef.current?.setSelectionRange(
                    replacement.cursor,
                    replacement.cursor,
                  );
                });
              }
              if (channel.mode === "standard" && nextDraft.trim())
                live.sendTyping();
            }}
            onKeyDown={(event) => {
              if (emojiSearch) {
                if (event.key === "ArrowDown" && emojiCandidates.length > 0) {
                  event.preventDefault();
                  setActiveEmojiIndex(
                    (current) => (current + 1) % emojiCandidates.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp" && emojiCandidates.length > 0) {
                  event.preventDefault();
                  setActiveEmojiIndex(
                    (current) =>
                      (current - 1 + emojiCandidates.length) %
                      emojiCandidates.length,
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEmojiSearch(null);
                  return;
                }
                if (
                  (event.key === "Enter" || event.key === "Tab") &&
                  activeEmoji
                ) {
                  event.preventDefault();
                  selectEmoji(activeEmoji);
                  return;
                }
              }
              if (mentionSearch) {
                if (event.key === "ArrowDown" && mentionCandidates.length > 0) {
                  event.preventDefault();
                  setActiveMentionIndex(
                    (current) => (current + 1) % mentionCandidates.length,
                  );
                  return;
                }
                if (event.key === "ArrowUp" && mentionCandidates.length > 0) {
                  event.preventDefault();
                  setActiveMentionIndex(
                    (current) =>
                      (current - 1 + mentionCandidates.length) %
                      mentionCandidates.length,
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setMentionSearch(null);
                  return;
                }
                if (
                  (event.key === "Enter" || event.key === "Tab") &&
                  activeMention
                ) {
                  event.preventDefault();
                  selectMention(activeMention);
                  return;
                }
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            onScroll={(event) => {
              if (!composerOverlayRef.current) return;
              composerOverlayRef.current.scrollTop =
                event.currentTarget.scrollTop;
              composerOverlayRef.current.scrollLeft =
                event.currentTarget.scrollLeft;
            }}
            placeholder={
              live.status === "ready" ? "Type a message..." : "Reconnecting..."
            }
            ref={composerRef}
            role="combobox"
            rows={2}
            aria-activedescendant={
              emojiSearch && activeEmoji
                ? `emoji-option-${channel.id}-${activeEmoji.hexcode}`
                : mentionSearch && activeMention
                  ? `mention-option-${activeMention.id}`
                  : undefined
            }
            aria-autocomplete="list"
            aria-controls={
              emojiSearch
                ? `emoji-list-${channel.id}`
                : mentionSearch
                  ? `mention-list-${channel.id}`
                  : undefined
            }
            aria-expanded={Boolean(mentionSearch || emojiSearch)}
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
        {mentionSearch ? (
          <div className="mention-autocomplete">
            <strong className="mention-autocomplete-heading">
              Mention a New Hire
            </strong>
            {mentionCandidates.length > 0 ? (
              <div id={`mention-list-${channel.id}`} role="listbox">
                {mentionCandidates.map((candidate, index) => (
                  <button
                    aria-selected={index === activeMentionIndex}
                    id={`mention-option-${candidate.id}`}
                    key={candidate.id}
                    onClick={() => selectMention(candidate)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveMentionIndex(index)}
                    role="option"
                    type="button"
                  >
                    <Avatar profile={candidate} />
                    {candidate.name}
                  </button>
                ))}
              </div>
            ) : (
              <span className="mention-autocomplete-empty">
                No matching New Hires
              </span>
            )}
          </div>
        ) : null}
        {emojiSearch ? (
          <div className="emoji-autocomplete">
            <strong className="emoji-autocomplete-heading">
              Choose an emoji
            </strong>
            {emojiCandidates.length > 0 ? (
              <div id={`emoji-list-${channel.id}`} role="listbox">
                {emojiCandidates.map((emoji, index) => (
                  <button
                    aria-label={`${emoji.label}, :${emoji.shortcode}:`}
                    aria-selected={index === activeEmojiIndex}
                    id={`emoji-option-${channel.id}-${emoji.hexcode}`}
                    key={emoji.hexcode}
                    onClick={() => selectEmoji(emoji)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveEmojiIndex(index)}
                    role="option"
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="emoji-autocomplete-glyph"
                    >
                      {emoji.unicode}
                    </span>
                    <span className="emoji-autocomplete-name">
                      :{emoji.shortcode}:
                    </span>
                    <span className="emoji-autocomplete-label">
                      {emoji.label}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <span className="emoji-autocomplete-empty">
                No matching emoji
              </span>
            )}
          </div>
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

function Messenger({ portal, profile }: { portal: Portal; profile: Profile }) {
  const [activeId, setActiveId] = useState<OfficeChannelSlug>("general");
  const [officeProfiles, setOfficeProfiles] = useState<
    ReadonlyMap<string, Profile>
  >(() => new Map([[profile.id, profile]]));
  const [onlineProfileIds, setOnlineProfileIds] = useState<ReadonlySet<string>>(
    () => new Set([profile.id]),
  );
  const [warmedChannelIds, setWarmedChannelIds] = useState<
    ReadonlySet<OfficeChannelSlug>
  >(() => new Set(["general"]));
  const [mentionedChannelIds, setMentionedChannelIds] = useState<
    ReadonlySet<OfficeChannelSlug>
  >(() => new Set());
  const [mentionAnnouncement, setMentionAnnouncement] = useState("");
  const requestedChannel = useRef<OfficeChannelSlug>("general");
  const readyChannelIds = useRef(new Set<OfficeChannelSlug>());
  const inbox = useInbox();
  const channels = listOfficeChannels();

  function warmChannel(channelId: OfficeChannelSlug) {
    setWarmedChannelIds((current) => {
      if (current.has(channelId)) return current;
      return new Set(current).add(channelId);
    });
  }

  function selectChannel(channel: OfficeChannel) {
    for (const item of inbox.items) {
      if (
        item.type === "mention" &&
        item.channelId === channel.id &&
        !item.read
      ) {
        item.markAsRead();
      }
    }
    setMentionedChannelIds((current) => {
      if (!current.has(channel.id)) return current;
      const next = new Set(current);
      next.delete(channel.id);
      return next;
    });
    requestedChannel.current = channel.id;
    warmChannel(channel.id);
    if (channel.id === activeId) return;
    if (readyChannelIds.current.has(channel.id)) {
      startTransition(() => setActiveId(channel.id));
    }
  }

  function channelReady(channelId: OfficeChannelSlug) {
    readyChannelIds.current.add(channelId);
    if (requestedChannel.current === channelId) {
      startTransition(() => setActiveId(channelId));
    }
  }

  function presenceChanged(presence: ChannelPresence) {
    setOfficeProfiles((current) =>
      updateOfficeProfiles(current, profile, presence),
    );
    if (presence?.kind === "detailed") {
      setOnlineProfileIds(
        new Set([profile.id, ...presence.participants.map(({ id }) => id)]),
      );
    }
  }

  function membersChanged(members: readonly MemberRow[]) {
    setOfficeProfiles((current) => updateMemberProfiles(current, members));
  }

  function mentioned(channelId: OfficeChannelSlug) {
    setMentionedChannelIds((current) => new Set(current).add(channelId));
    const channel = channels.find(({ id }) => id === channelId);
    setMentionAnnouncement(
      `You were mentioned in ${channel?.name ?? channelId}.`,
    );
  }

  return (
    <div className="office-body">
      <p className="sr-only" aria-live="polite">
        {mentionAnnouncement}
      </p>
      <aside className="channel-panel">
        <h1>Portal Messenger</h1>
        <span className="job-title">Signed in as {profile.name}</span>
        <nav aria-label="Office Channels">
          {channels.map((channel) => {
            const unread = inbox.channels.get(channel.id)?.unread ?? 0;
            const mentioned =
              mentionedChannelIds.has(channel.id) ||
              inbox.items.some(
                (item) =>
                  item.type === "mention" &&
                  item.channelId === channel.id &&
                  !item.read,
              );
            return (
              <button
                aria-current={channel.id === activeId ? "page" : undefined}
                className="channel-button"
                key={channel.id}
                onClick={() => selectChannel(channel)}
                onFocus={() => warmChannel(channel.id)}
                onPointerEnter={() => warmChannel(channel.id)}
                type="button"
              >
                <span className="channel-button-copy">
                  <strong># {channel.name}</strong>
                  <small>{channel.purpose}</small>
                </span>
                {unread > 0 ? <b>{unread}</b> : null}
                {mentioned ? (
                  <span className="mention-badge">
                    <span className="sr-only">Mentioned you</span>
                    <span aria-hidden="true">@</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
        <AccountMenu profile={profile} />
      </aside>
      <div className="conversation-panel">
        {channels.map((channel) =>
          warmedChannelIds.has(channel.id) ? (
            <LiveChannel
              active={channel.id === activeId}
              channel={channel}
              key={channel.id}
              officeProfiles={officeProfiles}
              onlineProfileIds={onlineProfileIds}
              onMembersChange={membersChanged}
              onMention={mentioned}
              onPresenceChange={presenceChanged}
              onReady={channelReady}
              portal={portal}
              profile={profile}
            />
          ) : null,
        )}
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
      <Messenger portal={portal} profile={profile} />
    </PortalProvider>
  );
}
