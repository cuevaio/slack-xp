import { planOfficeDay } from "@/lib/office-days/contract";
import type {
  OfficeDayRepository,
  ScriptedSystemEventPublisher,
} from "@/lib/office-days/types";

const SYSTEM_EVENT_OUTBOX_BATCH_SIZE = 50;

type OfficeDayPublishingDependencies = {
  officeDay: string;
  now: Date;
  repository: OfficeDayRepository;
  publisher: ScriptedSystemEventPublisher;
};

export async function flushDueSystemEvents({
  officeDay,
  now,
  repository,
  publisher,
}: OfficeDayPublishingDependencies): Promise<{
  published: number;
  failed: number;
}> {
  const pending = await repository.pendingSystemEvents(
    officeDay,
    now,
    SYSTEM_EVENT_OUTBOX_BATCH_SIZE,
  );
  let published = 0;
  let failed = 0;
  for (const entry of pending) {
    try {
      await repository.markSystemEventAttempt(entry.eventKey, now);
      await publisher.publishScriptedSystemEvent(entry);
      await repository.markSystemEventPublished(entry.eventKey, now);
      published += 1;
    } catch {
      failed += 1;
    }
  }
  return { published, failed };
}

export async function seedAndPublishOfficeDay(
  dependencies: OfficeDayPublishingDependencies,
): Promise<{ planned: number; published: number; failed: number }> {
  await dependencies.repository.seedOfficeDay(
    dependencies.officeDay,
    dependencies.now,
  );
  const result = await flushDueSystemEvents(dependencies);
  return {
    planned: planOfficeDay(dependencies.officeDay).length,
    ...result,
  };
}
