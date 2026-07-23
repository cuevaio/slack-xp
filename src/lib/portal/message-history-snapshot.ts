import type { SafetyProjectionStatus } from "@/lib/safety/contract";

export type MessageHistorySnapshot<Message extends { id: string }, Profile> = {
  messages: readonly Message[];
  profileIds: readonly string[];
  profilesById: ReadonlyMap<string, Profile>;
};

function isExpandedProfileSet(
  previousIds: readonly string[],
  currentIds: readonly string[],
): boolean {
  if (currentIds.length <= previousIds.length) return false;
  const currentIdSet = new Set(currentIds);
  return previousIds.every((profileId) => currentIdSet.has(profileId));
}

function keepsPreviousMessages<Message extends { id: string }>(
  previousMessages: readonly Message[],
  currentMessages: readonly Message[],
): boolean {
  return previousMessages.every(
    (message, index) => currentMessages[index]?.id === message.id,
  );
}

export function selectMessageHistorySnapshot<
  Message extends { id: string },
  Profile,
>({
  current,
  previous,
  previousProfileSafetyStatus,
  profileSafetyStatus,
  removalSafetyStatus,
}: {
  current: MessageHistorySnapshot<Message, Profile>;
  previous: MessageHistorySnapshot<Message, Profile> | null;
  previousProfileSafetyStatus: SafetyProjectionStatus;
  profileSafetyStatus: SafetyProjectionStatus;
  removalSafetyStatus: SafetyProjectionStatus;
}): MessageHistorySnapshot<Message, Profile> | null {
  if (profileSafetyStatus === "ready" && removalSafetyStatus === "ready") {
    return current;
  }
  if (
    (profileSafetyStatus !== "loading" &&
      profileSafetyStatus !== "unavailable") ||
    previousProfileSafetyStatus !== "ready" ||
    removalSafetyStatus !== "ready" ||
    !previous ||
    !isExpandedProfileSet(previous.profileIds, current.profileIds) ||
    !keepsPreviousMessages(previous.messages, current.messages)
  ) {
    return null;
  }
  return previous;
}
