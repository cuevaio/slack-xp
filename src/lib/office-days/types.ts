import type { PlannedSystemEvent } from "@/lib/office-days/contract";

export type ScriptedSystemEventOutboxEntry = PlannedSystemEvent & {
  attemptCount: number;
  lastAttemptAt: Date | null;
};

export type OfficeDayRepository = {
  seedOfficeDay(officeDay: string, seededAt: Date): Promise<number>;
  pendingSystemEvents(
    officeDay: string,
    dueAt: Date,
    limit: number,
  ): Promise<ScriptedSystemEventOutboxEntry[]>;
  markSystemEventAttempt(eventKey: string, attemptedAt: Date): Promise<void>;
  markSystemEventPublished(eventKey: string, publishedAt: Date): Promise<void>;
};

export type ScriptedSystemEventPublisher = {
  publishScriptedSystemEvent(
    entry: ScriptedSystemEventOutboxEntry,
  ): Promise<void>;
};
