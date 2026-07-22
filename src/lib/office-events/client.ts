"use client";

import type { ChannelStatus } from "@portalsdk/core";
import { useChannel, useInbox } from "@portalsdk/react";
import { useCallback, useEffect, useRef } from "react";
import { silenceOfficeEventAttention } from "@/lib/office-events/attention";
import {
  createOfficeEventDispatcher,
  OFFICE_EVENT_MESSAGE_TYPE,
  type OfficeEventDispatcher,
  type OfficeEventHandlers,
  parseOfficeEvent,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";

export type OfficeEventSubscription = {
  status: ChannelStatus;
  publishReaction(event: ReactionOfficeEvent): Promise<void>;
};

type OfficeEventSubscriptionOptions = OfficeEventHandlers & {
  channelId: string;
};

export function useOfficeEventSubscription({
  channelId,
  onReaction,
  onInvalidation,
}: OfficeEventSubscriptionOptions): OfficeEventSubscription {
  const latestHandlers = useRef<OfficeEventHandlers>({
    onReaction,
    onInvalidation,
  });
  const dispatchersByChannelId = useRef(
    new Map<string, OfficeEventDispatcher>(),
  );

  useEffect(() => {
    latestHandlers.current = { onReaction, onInvalidation };
  }, [onReaction, onInvalidation]);

  const dispatchMessage = useCallback(
    (message: unknown) => {
      let dispatcher = dispatchersByChannelId.current.get(channelId);
      if (!dispatcher) {
        dispatcher = createOfficeEventDispatcher({
          channelId,
          onReaction: (event) => latestHandlers.current.onReaction(event),
          onInvalidation: (event) =>
            latestHandlers.current.onInvalidation(event),
        });
        dispatchersByChannelId.current.set(channelId, dispatcher);
      }
      dispatcher.dispatch(message);
    },
    [channelId],
  );

  const channel = useChannel<unknown>({
    channelId,
    history: 100,
    readOn: "mount",
    onMessage: dispatchMessage,
  });
  const inbox = useInbox();

  useEffect(() => {
    for (const message of channel.messages) {
      dispatchMessage(message);
    }
  }, [channel.messages, dispatchMessage]);

  useEffect(() => {
    silenceOfficeEventAttention(inbox.channels.get(channelId));
  }, [channelId, inbox.channels]);

  useEffect(() => {
    if (channel.status !== "ready") return;
    if (!channel.hasPrevious || channel.isLoadingPrevious) return;
    void channel.loadPrevious();
  }, [
    channel.status,
    channel.hasPrevious,
    channel.isLoadingPrevious,
    channel.loadPrevious,
  ]);

  const publishReaction = useCallback(
    async (event: ReactionOfficeEvent): Promise<void> => {
      const parsed = parseOfficeEvent(event);
      if (
        parsed?.type !== "reaction.changed" ||
        parsed.officeDay !== channelId.slice(0, 10) ||
        channel.me?.id !== parsed.actorId
      ) {
        throw new TypeError("Invalid reaction Office Event publication.");
      }
      await channel.send({
        content: parsed,
        type: OFFICE_EVENT_MESSAGE_TYPE,
      });
      latestHandlers.current.onReaction(parsed);
    },
    [channel.me?.id, channel.send, channelId],
  );

  return { status: channel.status, publishReaction };
}
