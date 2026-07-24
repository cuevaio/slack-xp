export const OPEN_MESSENGER_MESSAGE_EVENT = "portal-messenger:open-message";

export type MessengerMessageTarget = {
  channelId: string;
  messageId: string;
};

export function messengerMessageTargetFromUrl(
  input: string | URL,
): MessengerMessageTarget | null {
  const url = typeof input === "string" ? new URL(input) : input;
  const channelId = url.searchParams.get("channel");
  const messageId = url.searchParams.get("message");
  return channelId &&
    channelId.length <= 100 &&
    messageId &&
    messageId.length <= 200
    ? { channelId, messageId }
    : null;
}

export function openMessengerMessage(target: MessengerMessageTarget) {
  const url = new URL(window.location.href);
  url.searchParams.set("channel", target.channelId);
  url.searchParams.set("message", target.messageId);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event(OPEN_MESSENGER_MESSAGE_EVENT));
}
