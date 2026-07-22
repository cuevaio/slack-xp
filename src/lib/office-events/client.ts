"use client";

import type { ChannelStatus } from "@portalsdk/core";
import { useChannel, useInbox } from "@portalsdk/react";
import { useCallback, useEffect, useRef } from "react";
import { silenceOfficeEventAttention } from "@/lib/office-events/attention";
import {
  createOfficeEventDispatcher,
  type OfficeEventDispatcher,
  type OfficeEventHandlers,
} from "@/lib/office-events/contract";

export type OfficeEventSubscription = {
  status: ChannelStatus;
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

  return { status: channel.status };
}
