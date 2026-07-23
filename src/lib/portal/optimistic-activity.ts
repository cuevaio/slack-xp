import type { ReactionOfficeEvent } from "@/lib/office-events/contract";

export function restoreFailedChatDraft(
  failedDraft: string,
  currentDraft: string,
): string {
  return currentDraft ? `${failedDraft}\n${currentDraft}` : failedDraft;
}

export function setOptimisticReactionPending(
  events: readonly ReactionOfficeEvent[],
  event: ReactionOfficeEvent,
  pending: boolean,
): ReactionOfficeEvent[] {
  if (!pending) {
    return events.filter(({ eventKey }) => eventKey !== event.eventKey);
  }
  return events.some(({ eventKey }) => eventKey === event.eventKey)
    ? [...events]
    : [...events, event];
}
