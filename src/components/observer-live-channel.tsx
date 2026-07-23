"use client";

import { Portal } from "@portalsdk/core";
import { PortalProvider, useChannel } from "@portalsdk/react";
import { useState } from "react";
import {
  listOfficeChannelsForDay,
  type OfficeChannel,
} from "@/lib/portal/channels";
import { officeDay } from "@/lib/portal/office-day";
import {
  isNewHireMessage,
  isScriptedSystemEventMessage,
  parseOfficeChannelMessages,
} from "@/lib/portal/visible-messages";

function LiveChannel({ channel }: { channel: OfficeChannel }) {
  const { messages, status } = useChannel({ channelId: channel.id });
  const visibleMessages = parseOfficeChannelMessages(
    messages,
    channel.id,
  ).messages;

  return (
    <>
      <div className="preview-channelbar">
        <div>
          <strong># {channel.slug}</strong>
          <span>{channel.purpose}</span>
        </div>
      </div>
      <div className="preview-messages" aria-live="polite">
        {visibleMessages.length === 0 ? (
          <p>
            {status === "ready"
              ? "No messages yet today."
              : "Connecting to the Shared Public Office..."}
          </p>
        ) : (
          visibleMessages.slice(-12).map((message) => {
            const scripted = isScriptedSystemEventMessage(message);
            const sender = scripted
              ? message.character.name
              : isNewHireMessage(message)
                ? "New Hire"
                : "Portal Systems";
            const text = message.content.text;
            return (
              <article key={message.id}>
                <div className="avatar avatar-blue" aria-hidden="true">
                  {sender.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="message-meta">
                    <strong>{sender}</strong>
                    <time>
                      {new Date(message.timestamp).toLocaleTimeString(
                        undefined,
                        {
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                    </time>
                  </div>
                  <p>{text}</p>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}

export function ObserverLiveChannel({
  publishableKey,
}: {
  publishableKey: string;
}) {
  const [portal] = useState(() => new Portal({ apiKey: publishableKey }));
  const channels = listOfficeChannelsForDay(officeDay());
  const [activeChannel, setActiveChannel] = useState(channels[0]);

  if (!activeChannel) return null;

  return (
    <PortalProvider client={portal}>
      <div
        className="preview-toolbar"
        aria-label="Office Channels"
        role="toolbar"
      >
        {channels.map((channel) => (
          <button
            aria-pressed={channel.id === activeChannel.id}
            key={channel.id}
            onClick={() => setActiveChannel(channel)}
            type="button"
          >
            # {channel.slug}
          </button>
        ))}
      </div>
      <LiveChannel channel={activeChannel} key={activeChannel.id} />
    </PortalProvider>
  );
}
