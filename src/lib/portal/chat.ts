import { officeChannelId } from "@/lib/portal/channels";

export const CHAT_TEXT_LIMIT = 1_000;
export const SETUP_VERIFIER_USER_ID = "portal-messenger-setup-verifier";

export type PortalChatContent = {
  text: string;
  mentionRanges?: PortalMentionRange[];
};

export type PortalMentionRange = {
  userId: string;
  start: number;
  length: number;
};

export type ChatTextPart =
  | { kind: "text"; value: string }
  | { kind: "link"; value: string };

export type SafePortalChatMessage = {
  id: string;
  channelId: string;
  senderId: string;
  timestamp: number;
  content: PortalChatContent;
  mentionedUserIds: readonly string[];
  status: "pending" | "sent" | "failed";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isSetupVerificationMessage(value: unknown): boolean {
  return (
    isObject(value) &&
    isObject(value.sender) &&
    value.sender.id === SETUP_VERIFIER_USER_ID
  );
}

export function generalChannelId(now: Date = new Date()): string {
  return officeChannelId("general", now);
}

export function parseChatContent(value: unknown): PortalChatContent | null {
  if (
    !isObject(value) ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => key !== "text" && key !== "mentionRanges",
    ) ||
    typeof value.text !== "string" ||
    value.text.trim().length === 0 ||
    value.text.length > CHAT_TEXT_LIMIT
  ) {
    return null;
  }

  if (value.mentionRanges === undefined) {
    return { text: value.text };
  }
  if (!Array.isArray(value.mentionRanges)) return null;

  const mentionRanges: PortalMentionRange[] = [];
  let previousEnd = 0;
  for (const candidate of value.mentionRanges) {
    if (
      !isObject(candidate) ||
      Object.keys(candidate).some(
        (key) => key !== "userId" && key !== "start" && key !== "length",
      ) ||
      typeof candidate.userId !== "string" ||
      candidate.userId.length === 0 ||
      !Number.isInteger(candidate.start) ||
      !Number.isInteger(candidate.length) ||
      (candidate.start as number) < previousEnd ||
      (candidate.length as number) < 2 ||
      (candidate.start as number) + (candidate.length as number) >
        value.text.length ||
      value.text[candidate.start as number] !== "@"
    ) {
      return null;
    }
    const range = {
      userId: candidate.userId,
      start: candidate.start as number,
      length: candidate.length as number,
    };
    mentionRanges.push(range);
    previousEnd = range.start + range.length;
  }

  return { text: value.text, mentionRanges };
}

export function validateChatDraft(draft: string): PortalChatContent {
  if (draft.trim().length === 0) {
    throw new Error("Write a message before sending.");
  }
  if (draft.length > CHAT_TEXT_LIMIT) {
    throw new Error("Messages are limited to 1,000 characters.");
  }
  return { text: draft };
}

export function createChatContentWithMentions(
  text: string,
  mentions: readonly { userId: string; label: string }[],
): PortalChatContent {
  const content = validateChatDraft(text);
  const mentionRanges: PortalMentionRange[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    const start = text.indexOf(mention.label, cursor);
    if (start === -1) continue;
    mentionRanges.push({
      userId: mention.userId,
      start,
      length: mention.label.length,
    });
    cursor = start + mention.label.length;
  }
  return mentionRanges.length > 0 ? { ...content, mentionRanges } : content;
}

export function parsePortalChatMessage(
  value: unknown,
): SafePortalChatMessage | null {
  if (
    !isObject(value) ||
    isSetupVerificationMessage(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    typeof value.channelId !== "string" ||
    value.channelId.length === 0 ||
    !isObject(value.sender) ||
    typeof value.sender.id !== "string" ||
    value.sender.id.length === 0 ||
    value.sender.anon !== false ||
    typeof value.timestamp !== "number" ||
    !Number.isFinite(value.timestamp) ||
    !Number.isFinite(new Date(value.timestamp).getTime()) ||
    value.kind !== "text" ||
    value.type !== "message" ||
    value.ephemeral !== false ||
    value.retracted !== false ||
    (value.status !== "pending" &&
      value.status !== "sent" &&
      value.status !== "failed")
  ) {
    return null;
  }

  const content = parseChatContent(value.content);
  const mentionedUserIds = Array.isArray(value.mentions)
    ? value.mentions
        .filter(
          (mention): mention is { userId: string } =>
            isObject(mention) && typeof mention.userId === "string",
        )
        .map(({ userId }) => userId)
    : [];
  return content
    ? {
        id: value.id,
        channelId: value.channelId,
        senderId: value.sender.id,
        timestamp: value.timestamp,
        content,
        mentionedUserIds,
        status: value.status,
      }
    : null;
}

const URL_PATTERN = /https?:\/\/[^\s<>]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:]+$/u;

function splitTrailingUrlPunctuation(candidate: string): {
  url: string;
  trailing: string;
} {
  let url = candidate;
  let trailing = "";

  const punctuation = url.match(TRAILING_PUNCTUATION)?.[0] ?? "";
  if (punctuation) {
    url = url.slice(0, -punctuation.length);
    trailing = punctuation;
  }

  while (url.endsWith(")")) {
    const openCount = (url.match(/\(/gu) ?? []).length;
    const closeCount = (url.match(/\)/gu) ?? []).length;
    if (closeCount <= openCount) break;
    url = url.slice(0, -1);
    trailing = `)${trailing}`;
  }

  return { url, trailing };
}

export function linkifyChatText(text: string): ChatTextPart[] {
  const parts: ChatTextPart[] = [];
  let cursor = 0;

  function pushText(value: string): void {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.kind === "text") {
      previous.value += value;
    } else {
      parts.push({ kind: "text", value });
    }
  }

  for (const match of text.matchAll(URL_PATTERN)) {
    const index = match.index;
    const candidate = match[0];
    if (index > cursor) {
      pushText(text.slice(cursor, index));
    }

    const { url, trailing } = splitTrailingUrlPunctuation(candidate);
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        parts.push({ kind: "link", value: url });
      } else {
        pushText(url);
      }
    } catch {
      pushText(url);
    }
    if (trailing) {
      pushText(trailing);
    }
    cursor = index + candidate.length;
  }

  if (cursor < text.length) {
    pushText(text.slice(cursor));
  }

  return parts.length > 0 ? parts : [{ kind: "text", value: text }];
}
