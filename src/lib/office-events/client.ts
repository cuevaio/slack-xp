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
import { officeDayFromChannelId } from "@/lib/portal/channels";
import {
  currentActiveNewHireIds,
  hasCurrentRealtimeState,
  PRESENCE_ACTIVITY_KIND,
} from "@/lib/portal/presence";

// The pinned Portal SDK expires transient activity after five seconds.
const PRESENCE_HEARTBEAT_INTERVAL_MS = 4_000;

export type OfficeEventSubscription = {
  activeNewHireIds: readonly string[];
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
    if (!hasCurrentRealtimeState(channel.status)) return;

    const sendHeartbeat = () => {
      channel.sendActivity(PRESENCE_ACTIVITY_KIND);
    };
    const sendHeartbeatWhenVisible = () => {
      if (!document.hidden) sendHeartbeat();
    };
    sendHeartbeat();
    const interval = window.setInterval(
      sendHeartbeat,
      PRESENCE_HEARTBEAT_INTERVAL_MS,
    );
    window.addEventListener("focus", sendHeartbeat);
    document.addEventListener("visibilitychange", sendHeartbeatWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", sendHeartbeat);
      document.removeEventListener(
        "visibilitychange",
        sendHeartbeatWhenVisible,
      );
    };
  }, [channel.sendActivity, channel.status]);

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
        parsed.officeDay !== officeDayFromChannelId(channelId) ||
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

  const activeNewHireIds = currentActiveNewHireIds(
    channel.activity,
    channel.me?.id,
    channel.status,
  );

  return { activeNewHireIds, status: channel.status, publishReaction };
}
