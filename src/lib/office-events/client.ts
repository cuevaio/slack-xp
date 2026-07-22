"use client";

import { useChannel, useInbox } from "@portalsdk/react";
import { useCallback, useEffect, useRef } from "react";
import { silenceOfficeEventAttention } from "@/lib/office-events/attention";
import {
  createOfficeEventDispatcher,
  type OfficeInvalidationEvent,
  type ReactionOfficeEvent,
} from "@/lib/office-events/contract";

export type OfficeEventSubscription = {
  status:
    | "idle"
    | "connecting"
    | "ready"
    | "reconnecting"
    | "degraded"
    | "degraded-http"
    | "blocked";
};

export function useOfficeEventSubscription({
  channelId,
  onReaction,
  onInvalidation,
}: {
  channelId: string;
  onReaction(event: ReactionOfficeEvent): void;
  onInvalidation(event: OfficeInvalidationEvent): void;
}): OfficeEventSubscription {
  const handlers = useRef({ onReaction, onInvalidation });
  const dispatchers = useRef(
    new Map<string, ReturnType<typeof createOfficeEventDispatcher>>(),
  );

  useEffect(() => {
    handlers.current = { onReaction, onInvalidation };
  }, [onReaction, onInvalidation]);

  const dispatch = useCallback(
    (message: unknown) => {
      let dispatcher = dispatchers.current.get(channelId);
      if (!dispatcher) {
        dispatcher = createOfficeEventDispatcher({
          channelId,
          onReaction: (event) => handlers.current.onReaction(event),
          onInvalidation: (event) => handlers.current.onInvalidation(event),
        });
        dispatchers.current.set(channelId, dispatcher);
      }
      dispatcher.dispatch(message);
    },
    [channelId],
  );

  const channel = useChannel<unknown>({
    channelId,
    history: 100,
    readOn: "mount",
    onMessage: dispatch,
  });
  const inbox = useInbox();

  useEffect(() => {
    silenceOfficeEventAttention(inbox.channels.get(channelId));
  }, [channelId, inbox.channels]);

  useEffect(() => {
    if (
      channel.status === "ready" &&
      channel.hasPrevious &&
      !channel.isLoadingPrevious
    ) {
      void channel.loadPrevious();
    }
  }, [
    channel.status,
    channel.hasPrevious,
    channel.isLoadingPrevious,
    channel.loadPrevious,
  ]);

  return { status: channel.status };
}
