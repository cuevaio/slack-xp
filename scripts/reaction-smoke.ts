import {
  type ChannelHandle,
  type InboxHandle,
  type Message,
  Portal,
} from "@portalsdk/core";
import {
  createReactionToggle,
  projectReactions,
  REACTION_EVENT_TYPE,
  type ReactionToggleContent,
} from "../src/lib/portal/reactions";
import { createPortalSession } from "../src/lib/portal/server";

type SmokeContent = { text: string } | ReactionToggleContent;
type Client = {
  channel: ChannelHandle<SmokeContent>;
  inbox: InboxHandle;
  stopInbox: () => void;
};

const secret = process.env.PORTAL_SECRET;
const publicKey = process.env.NEXT_PUBLIC_PORTAL_KEY;
const channelId = process.env.PORTAL_SMOKE_CHANNEL ?? "general";
if (!secret || !publicKey) throw new Error("Portal credentials are required.");
if (channelId !== "general" && channelId !== "announcements") {
  throw new Error("PORTAL_SMOKE_CHANNEL must be an Office Channel.");
}
const portalSecret = secret;
const portalPublicKey = publicKey;

function waitFor(
  subscribe: (listener: () => void) => () => void,
  condition: () => boolean,
  failure: string,
) {
  if (condition()) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    let off: () => void = () => undefined;
    const timeout = setTimeout(() => {
      off();
      reject(new Error(failure));
    }, 10_000);
    off = subscribe(() => {
      if (!condition()) return;
      clearTimeout(timeout);
      off();
      resolve();
    });
  });
}

async function open(userId: string, history: number | "none"): Promise<Client> {
  const { token } = await createPortalSession(portalSecret, {
    id: userId,
    name: userId,
    imageUrl: null,
  });
  const portal = new Portal({ apiKey: portalPublicKey, token });
  const channel = portal.channel<SmokeContent>(channelId, { history });
  const inbox = portal.inbox();
  const stopInbox = inbox.subscribe(() => undefined);
  channel.acquire();
  await Promise.all([
    waitFor(
      channel.subscribe.bind(channel),
      () => channel.status === "ready",
      "Channel did not become ready.",
    ),
    waitFor(
      inbox.subscribe.bind(inbox),
      () => inbox.status === "ready",
      "Inbox did not become ready.",
    ),
  ]);
  return { channel, inbox, stopInbox };
}

function reactionUsers(client: Client, targetMessageId: string) {
  return projectReactions(client.channel.messages)[targetMessageId]?.like ?? [];
}

function waitForReactionCount(
  client: Client,
  targetMessageId: string,
  count: number,
) {
  return waitFor(
    client.channel.subscribe.bind(client.channel),
    () => reactionUsers(client, targetMessageId).length === count,
    `Expected ${count} reactions for ${targetMessageId}.`,
  );
}

const runId = `${Date.now()}-${crypto.randomUUID()}`;
const userA = `reaction-smoke-a-${runId}`;
const userB = `reaction-smoke-b-${runId}`;
const userC = `reaction-smoke-c-${runId}`;
const clients: Client[] = [];

try {
  const first = await open(userA, 100);
  clients.push(first);
  const second = await open(userB, 100);
  clients.push(second);

  const chat = await first.channel.send({
    content: { text: `Reaction smoke ${runId}` },
  });
  await waitFor(
    second.channel.subscribe.bind(second.channel),
    () => second.channel.messages.some(({ id }) => id === chat.id),
    "Peer did not receive the target chat message.",
  );

  second.channel.markAsRead();
  second.inbox.channels.get(channelId)?.markAsRead();
  const unreadBefore = second.channel.unread;
  const inboxUnreadBefore = second.inbox.channels.get(channelId)?.unread ?? 0;

  const addA = createReactionToggle(chat.id, "like");
  const firstCount = waitForReactionCount(first, chat.id, 1);
  const secondCount = waitForReactionCount(second, chat.id, 1);
  await first.channel.send(addA);
  await Promise.all([firstCount, secondCount]);

  const addB = createReactionToggle(chat.id, "like");
  const firstTwo = waitForReactionCount(first, chat.id, 2);
  const secondTwo = waitForReactionCount(second, chat.id, 2);
  await second.channel.send(addB);
  await Promise.all([firstTwo, secondTwo]);

  const removeA = createReactionToggle(chat.id, "like");
  const firstOne = waitForReactionCount(first, chat.id, 1);
  const secondOne = waitForReactionCount(second, chat.id, 1);
  await first.channel.send(removeA);
  await Promise.all([firstOne, secondOne]);
  const late = await open(userC, 2);
  clients.push(late);
  await waitFor(
    late.channel.subscribe.bind(late.channel),
    () =>
      late.channel.messages.some(
        ({ content }) =>
          typeof content === "object" &&
          content !== null &&
          "mutationId" in content &&
          content.mutationId === removeA.content.mutationId,
      ),
    "Late client did not receive its initial history window.",
  );
  while (!late.channel.messages.some(({ id }) => id === chat.id)) {
    if (!(await late.channel.loadPrevious())) break;
  }
  if (reactionUsers(late, chat.id).join() !== userB) {
    throw new Error("Late client did not reconstruct the reaction state.");
  }

  const visibleMessages = late.channel.messages.filter(
    (message): message is Message<{ text: string }> =>
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof message.content.text === "string",
  );
  if (visibleMessages.some(({ type }) => type === REACTION_EVENT_TYPE)) {
    throw new Error("A reaction record appeared as chat.");
  }

  const secondChat = await first.channel.send({
    content: { text: `Grouping check ${runId}` },
  });
  await waitFor(
    late.channel.subscribe.bind(late.channel),
    () => late.channel.messages.some(({ id }) => id === secondChat.id),
    "Late client did not receive the grouping check message.",
  );
  const visibleAfter = late.channel.messages.filter(
    (message): message is Message<{ text: string }> =>
      typeof message.content === "object" &&
      message.content !== null &&
      "text" in message.content &&
      typeof message.content.text === "string",
  );
  const targetIndex = visibleAfter.findIndex(({ id }) => id === chat.id);
  const groupingIndex = visibleAfter.findIndex(
    ({ id }) => id === secondChat.id,
  );
  if (targetIndex < 0 || groupingIndex !== targetIndex + 1) {
    throw new Error(
      "Hidden reaction records changed visible message adjacency.",
    );
  }

  await waitFor(
    second.channel.subscribe.bind(second.channel),
    () => second.channel.unread > unreadBefore,
    "Persistent reaction records did not advance channel unread state.",
  );
  await waitFor(
    second.inbox.subscribe.bind(second.inbox),
    () =>
      (second.inbox.channels.get(channelId)?.unread ?? 0) > inboxUnreadBefore,
    "Persistent reaction records did not advance inbox unread state.",
  );

  console.log(
    JSON.stringify({
      channelId,
      finalReactionUsers: reactionUsers(late, chat.id),
      channelUnreadDelta: second.channel.unread - unreadBefore,
      inboxUnreadDelta:
        (second.inbox.channels.get(channelId)?.unread ?? 0) - inboxUnreadBefore,
      hiddenReactionRecords: late.channel.messages.filter(
        ({ type }) => type === REACTION_EVENT_TYPE,
      ).length,
      status: "passed",
    }),
  );
} finally {
  for (const client of clients) {
    client.stopInbox();
    client.channel.release();
  }
}

process.exit(0);
