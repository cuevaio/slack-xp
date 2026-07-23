type ChatComposerKeyDown = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
};

export function shouldSendChatComposerMessage({
  key,
  shiftKey,
  isComposing,
}: ChatComposerKeyDown): boolean {
  return key === "Enter" && !shiftKey && !isComposing;
}

export function shouldSelectChatComposerMention(
  event: ChatComposerKeyDown,
): boolean {
  return event.key === "Tab" || shouldSendChatComposerMessage(event);
}
