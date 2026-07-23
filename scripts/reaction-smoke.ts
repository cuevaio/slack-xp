import { type ChannelHandle, type Message, Portal } from "@portalsdk/core";
import { createPortalSession } from "../src/lib/portal/server";

const secret = process.env.PORTAL_SECRET;
const publicKey = process.env.NEXT_PUBLIC_PORTAL_KEY;
const channelId = process.env.PORTAL_SMOKE_CHANNEL ?? "general";
if (!secret || !publicKey) throw new Error("Portal credentials are required.");
const portalSecret = secret;
const portalPublicKey = publicKey;

function ready(channel: ChannelHandle) {
  if (channel.status === "ready") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Channel did not become ready.")),
      10_000,
    );
    const off = channel.on("status", (status, error) => {
      if (error) {
        clearTimeout(timeout);
        off();
        reject(error);
      } else if (status === "ready") {
        clearTimeout(timeout);
        off();
        resolve();
      }
    });
  });
}

function nextReaction(channel: ChannelHandle) {
  return new Promise<Message>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Reaction broadcast not received.")),
      10_000,
    );
    const off = channel.on("message", (message) => {
      if (message.type !== "reaction.state") return;
      clearTimeout(timeout);
      off();
      resolve(message);
    });
  });
}

async function open(userId: string) {
  const { token } = await createPortalSession(portalSecret, {
    id: userId,
    name: userId,
    imageUrl: null,
  });
  const portal = new Portal({ apiKey: portalPublicKey, token });
  const channel = portal.channel(channelId, { history: "none" });
  channel.acquire();
  await ready(channel);
  return channel;
}

const messageId = `reaction-smoke-${Date.now()}`;
const first = await open("reaction-smoke-a");
const second = await open("reaction-smoke-b");
const firstUpdate = nextReaction(first);
const secondUpdate = nextReaction(second);
await first.send({
  ephemeral: true,
  type: "reaction.toggle",
  content: { messageId, reaction: "like" },
});
const updates = await Promise.all([firstUpdate, secondUpdate]);
for (const update of updates) {
  const content = update.content as { reactions?: { like?: string[] } };
  if (!content.reactions?.like?.includes("reaction-smoke-a")) {
    throw new Error("Reaction state did not include the sender.");
  }
}

const late = await open("reaction-smoke-late");
const snapshot = late.ext?.reactions as
  | { reactions?: Record<string, { like?: string[] }> }
  | undefined;
if (!snapshot?.reactions?.[messageId]?.like?.includes("reaction-smoke-a")) {
  throw new Error("Late join snapshot did not include the reaction.");
}

const removedFirst = nextReaction(first);
const removedSecond = nextReaction(second);
await first.send({
  ephemeral: true,
  type: "reaction.toggle",
  content: { messageId, reaction: "like" },
});
const removals = await Promise.all([removedFirst, removedSecond]);
for (const removal of removals) {
  const content = removal.content as { reactions?: { like?: string[] } };
  if ((content.reactions?.like?.length ?? 0) !== 0) {
    throw new Error("Reaction toggle did not remove the sender.");
  }
}

first.release();
second.release();
late.release();
console.log("Reaction broadcast, toggle, and late-join snapshot passed.");
