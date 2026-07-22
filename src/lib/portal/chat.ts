export const CHAT_TEXT_LIMIT = 1_000;

export type PortalChatContent = {
  text: string;
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
  status: "pending" | "sent" | "failed";
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function generalChannelId(now: Date = new Date()): string {
  return `${now.toISOString().slice(0, 10)}:general`;
}

export function parseChatContent(value: unknown): PortalChatContent | null {
  if (
    !isObject(value) ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.text !== "string" ||
    value.text.trim().length === 0 ||
    value.text.length > CHAT_TEXT_LIMIT
  ) {
    return null;
  }

  return { text: value.text };
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

export function parsePortalChatMessage(
  value: unknown,
): SafePortalChatMessage | null {
  if (
    !isObject(value) ||
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
  return content
    ? {
        id: value.id,
        channelId: value.channelId,
        senderId: value.sender.id,
        timestamp: value.timestamp,
        content,
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
