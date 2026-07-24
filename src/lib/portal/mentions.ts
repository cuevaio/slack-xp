import type { InboxItem, Message } from "@portalsdk/core";

export type MentionSourceMessage<M = unknown> = {
  id: string;
  seq: number;
  type: string;
  content: M;
  sender: { id: string; anon: boolean; username?: string };
  timestamp: number;
  retracted: false;
};

type PortalHistoryFetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function mentionCoordinates(item: InboxItem) {
  if (typeof item.data !== "object" || item.data === null) return null;
  const seq = "seq" in item.data ? item.data.seq : undefined;
  const from = "from" in item.data ? item.data.from : undefined;
  return Number.isFinite(seq) &&
    Number.isInteger(seq) &&
    (seq as number) >= 0 &&
    typeof from === "string" &&
    from.length > 0
    ? { seq: seq as number, from }
    : null;
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function parseSource<M>(
  payload: unknown,
  seq: number,
  from: string,
): MentionSourceMessage<M> | null {
  if (typeof payload !== "object" || payload === null || !("msgs" in payload))
    return null;
  if (!Array.isArray(payload.msgs)) return null;
  const record = payload.msgs.find(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      "seq" in candidate &&
      candidate.seq === seq,
  );
  if (typeof record !== "object" || record === null) return null;
  const sender = "sender" in record ? record.sender : undefined;
  const content = "content" in record ? record.content : undefined;
  if (
    !("id" in record) ||
    typeof record.id !== "string" ||
    !("type" in record) ||
    typeof record.type !== "string" ||
    typeof sender !== "object" ||
    sender === null ||
    !("id" in sender) ||
    sender.id !== from ||
    !("anon" in sender) ||
    typeof sender.anon !== "boolean" ||
    !("timestamp" in record) ||
    !Number.isFinite(record.timestamp) ||
    !("retracted" in record) ||
    record.retracted !== false ||
    typeof content !== "object" ||
    content === null ||
    !("text" in content) ||
    typeof content.text !== "string"
  ) {
    return null;
  }
  const username =
    "username" in sender && typeof sender.username === "string"
      ? sender.username
      : undefined;
  return {
    id: record.id,
    seq,
    type: record.type,
    content: content as M,
    sender: { id: from, anon: sender.anon, ...(username ? { username } : {}) },
    timestamp: record.timestamp as number,
    retracted: false,
  };
}

export async function resolveMentionSources<M = unknown>(
  items: readonly InboxItem[],
  tokenSource: () => Promise<string>,
  options: {
    fetcher?: PortalHistoryFetcher;
    signal?: AbortSignal;
    concurrency?: number;
  } = {},
) {
  const { fetcher = fetch, signal, concurrency = 8 } = options;
  const results = new Map<string, MentionSourceMessage<M> | null>(
    items.map((item) => [item.id, null]),
  );
  const resolvable = items.flatMap((item) => {
    const coordinates = mentionCoordinates(item);
    return coordinates && item.channelId
      ? [{ item, channelId: item.channelId, ...coordinates }]
      : [];
  });
  if (resolvable.length === 0) return results;

  let token: string;
  try {
    token = await tokenSource();
  } catch {
    if (signal?.aborted) throw abortError();
    return results;
  }
  if (signal?.aborted) throw abortError();

  let cursor = 0;
  async function worker() {
    while (cursor < resolvable.length) {
      const current = resolvable[cursor];
      cursor++;
      const query = new URLSearchParams({
        from: String(current.seq),
        to: String(current.seq),
      });
      try {
        const response = await fetcher(
          `https://realtime.useportal.co/v1/channels/${encodeURIComponent(current.channelId)}/history?${query}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal,
          },
        );
        if (!response.ok) continue;
        const payload: unknown = await response.json();
        results.set(
          current.item.id,
          parseSource<M>(payload, current.seq, current.from),
        );
      } catch {
        if (signal?.aborted) throw abortError();
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), resolvable.length) },
      () => worker(),
    ),
  );
  if (signal?.aborted) throw abortError();
  return results;
}

export function viewedMentionIds(
  items: readonly InboxItem[],
  sources: ReadonlyMap<string, MentionSourceMessage | null>,
  channelId: string,
  messages: readonly Pick<Message<unknown>, "id">[],
  documentVisible: boolean,
) {
  if (!documentVisible) return [];
  const viewedMessageIds = new Set(messages.map(({ id }) => id));
  return items.flatMap((item) => {
    const source = sources.get(item.id);
    return !item.read &&
      item.channelId === channelId &&
      source !== null &&
      source !== undefined &&
      viewedMessageIds.has(source.id)
      ? [item.id]
      : [];
  });
}

export function mentionHistoryAction(input: {
  active: boolean;
  targetMessageId: string | undefined;
  loadedMessageIds: readonly string[];
  ready: boolean;
  hasPrevious: boolean;
  isLoadingPrevious: boolean;
}): "wait" | "focus" | "load" | "unavailable" {
  if (!input.active || !input.targetMessageId || !input.ready) return "wait";
  if (input.loadedMessageIds.includes(input.targetMessageId)) return "focus";
  if (input.isLoadingPrevious) return "wait";
  return input.hasPrevious ? "load" : "unavailable";
}
