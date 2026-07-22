import {
  EMPLOYMENT_SYSTEM_EVENT_VERSION,
  type EmploymentPortalAuthority,
  type EmploymentRepository,
  SEND_HOME_SYSTEM_EVENT_TEXT,
  type SendHomeResult,
} from "@/lib/employment/contract";
import {
  createSendHomeSystemEventKey,
  officeDayExpiry,
} from "@/lib/employment/domain";
import {
  createOfficeEventKey,
  OFFICE_EVENT_VERSION,
  officeEventChannelIdForDay,
} from "@/lib/office-events/contract";
import { listOfficeChannelsForDay } from "@/lib/portal/channels";
import { officeDay } from "@/lib/portal/office-day";

const EMPLOYMENT_EFFECT_BATCH_SIZE = 50;

export { EmploymentActionError } from "@/lib/employment/contract";

export async function flushEmploymentEffects({
  repository,
  portal,
  now = new Date(),
}: {
  repository: EmploymentRepository;
  portal: EmploymentPortalAuthority;
  now?: Date;
}): Promise<number> {
  const pending = await repository.pendingEmploymentEffects(
    EMPLOYMENT_EFFECT_BATCH_SIZE,
  );
  let completed = 0;
  let firstFailure: unknown;
  for (const effect of pending) {
    if (!effect.invalidationPublishedAt) {
      try {
        await portal.publishEmploymentInvalidation({
          version: OFFICE_EVENT_VERSION,
          type: "employment.invalidated",
          eventKey: createOfficeEventKey(
            "employment.invalidated",
            effect.actionId,
          ),
          occurredAt: effect.actedAt.toISOString(),
          newHireId: effect.targetNewHireId,
        });
        await repository.markEmploymentInvalidationPublished(
          effect.actionId,
          now,
        );
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (!effect.bansAppliedAt) {
      try {
        await portal.applySendHomeBans({
          channelIds: [
            ...listOfficeChannelsForDay(effect.officeDay).map(({ id }) => id),
            officeEventChannelIdForDay(effect.officeDay),
          ],
          newHireId: effect.targetNewHireId,
          expiresAt: effect.expiresAt,
        });
        await repository.markEmploymentBansApplied(effect.actionId, now);
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (!effect.publicEventPublishedAt) {
      try {
        await portal.publishSendHomeSystemEvent({
          version: EMPLOYMENT_SYSTEM_EVENT_VERSION,
          type: "employment.sent-home",
          eventKey: createSendHomeSystemEventKey(
            effect.officeDay,
            effect.actionId,
          ),
          officeDay: effect.officeDay,
          operatorId: effect.operatorId,
          targetNewHireId: effect.targetNewHireId,
          expiresAt: effect.expiresAt.toISOString(),
          text: SEND_HOME_SYSTEM_EVENT_TEXT,
        });
        await repository.markEmploymentPublicEventPublished(
          effect.actionId,
          now,
        );
      } catch (error) {
        firstFailure ??= error;
      }
    }
    completed += 1;
  }
  if (firstFailure) throw firstFailure;
  return completed;
}

export async function sendHomeNewHire({
  repository,
  portal,
  requestId,
  operatorId,
  targetNewHireId,
  privateReason,
  reportId,
  now = new Date(),
}: {
  repository: EmploymentRepository;
  portal: EmploymentPortalAuthority;
  requestId: string;
  operatorId: string;
  targetNewHireId: string;
  privateReason: string;
  reportId?: string;
  now?: Date;
}): Promise<SendHomeResult> {
  const currentOfficeDay = officeDay(now);
  const recorded = await repository.recordSendHome({
    actionId: crypto.randomUUID(),
    requestId,
    operatorId,
    targetNewHireId,
    officeDay: currentOfficeDay,
    expiresAt: officeDayExpiry(now),
    reportId: reportId ?? null,
    privateReason,
    actedAt: now,
  });
  await flushEmploymentEffects({ repository, portal, now });
  return {
    actionId: recorded.action.actionId,
    status: recorded.status === "created" ? "sent-home" : "already-sent-home",
    officeDay: recorded.action.officeDay,
    expiresAt: new Date(recorded.action.expiresAt),
  };
}
