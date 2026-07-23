import {
  EMPLOYMENT_SYSTEM_EVENT_VERSION,
  type EmploymentPortalAuthority,
  type EmploymentRepository,
  REINSTATEMENT_SYSTEM_EVENT_TEXT,
  type ReinstatementResult,
  SEND_HOME_SYSTEM_EVENT_TEXT,
  type SendHomeResult,
  TERMINATION_SYSTEM_EVENT_TEXT,
  type TerminationResult,
} from "@/lib/employment/contract";
import {
  createSendHomeSystemEventKey,
  createTerminationSystemEventKey,
  officeDayExpiry,
} from "@/lib/employment/domain";
import {
  createOfficeEventKey,
  OFFICE_EVENT_VERSION,
} from "@/lib/office-events/contract";
import {
  OFFICE_CHANNEL_DEFINITIONS,
  officeDayChannelIds,
} from "@/lib/portal/channels";
import { officeDay } from "@/lib/portal/office-day";

const EMPLOYMENT_EFFECT_BATCH_SIZE = 50;
const EMPLOYMENT_PORTAL_CHANNEL_NAMES = [
  ...OFFICE_CHANNEL_DEFINITIONS.map(({ slug }) => slug),
  "office-events",
] as const;

function employmentPortalChannelIds(currentOfficeDay: string): string[] {
  return officeDayChannelIds(EMPLOYMENT_PORTAL_CHANNEL_NAMES, currentOfficeDay);
}

function terminationSystemEventDetails(action: "terminated" | "reinstated"): {
  type: "employment.terminated" | "employment.reinstated";
  text: string;
} {
  if (action === "terminated") {
    return {
      type: "employment.terminated",
      text: TERMINATION_SYSTEM_EVENT_TEXT,
    };
  }
  return {
    type: "employment.reinstated",
    text: REINSTATEMENT_SYSTEM_EVENT_TEXT,
  };
}

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
          channelIds: employmentPortalChannelIds(effect.officeDay),
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

export async function flushTerminationEffects({
  repository,
  portal,
  now = new Date(),
}: {
  repository: EmploymentRepository;
  portal: EmploymentPortalAuthority;
  now?: Date;
}): Promise<number> {
  const pending = await repository.pendingTerminationEffects(
    EMPLOYMENT_EFFECT_BATCH_SIZE,
  );
  let firstFailure: unknown;
  for (const effect of pending) {
    const channelIds = employmentPortalChannelIds(effect.officeDay);
    if (!effect.invalidationPublishedAt) {
      try {
        await portal.publishEmploymentInvalidation({
          version: OFFICE_EVENT_VERSION,
          type: "employment.invalidated",
          eventKey: createOfficeEventKey(
            "employment.invalidated",
            effect.effectId,
          ),
          occurredAt: effect.actedAt.toISOString(),
          newHireId: effect.targetNewHireId,
        });
        await repository.markTerminationInvalidationPublished(
          effect.effectId,
          now,
        );
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (!effect.portalAccessReconciledAt) {
      try {
        if (effect.action === "terminated") {
          await portal.applyTerminationBans({
            channelIds,
            newHireId: effect.targetNewHireId,
          });
        } else {
          const state = await repository.getEmploymentState(
            effect.targetNewHireId,
            now,
          );
          if (
            state.access.reason !== "deleted" &&
            state.access.reason !== "terminated"
          ) {
            await portal.reconcileReinstatementBans({
              channelIds,
              newHireId: effect.targetNewHireId,
              sentHomeUntil:
                state.access.reason === "sent-home" ? state.access.until : null,
            });
          }
        }
        await repository.markTerminationPortalAccessReconciled(
          effect.effectId,
          now,
        );
      } catch (error) {
        firstFailure ??= error;
      }
    }
    if (!effect.publicEventPublishedAt) {
      try {
        const eventDetails = terminationSystemEventDetails(effect.action);
        await portal.publishTerminationSystemEvent({
          version: EMPLOYMENT_SYSTEM_EVENT_VERSION,
          type: eventDetails.type,
          eventKey: createTerminationSystemEventKey(
            effect.action,
            effect.officeDay,
            effect.effectId,
          ),
          officeDay: effect.officeDay,
          operatorId: effect.operatorId,
          targetNewHireId: effect.targetNewHireId,
          terminationId: effect.terminationId,
          text: eventDetails.text,
        });
        await repository.markTerminationPublicEventPublished(
          effect.effectId,
          now,
        );
      } catch (error) {
        firstFailure ??= error;
      }
    }
  }
  if (firstFailure) throw firstFailure;
  return pending.length;
}

export async function terminateNewHire({
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
}): Promise<TerminationResult> {
  const recorded = await repository.recordTermination({
    terminationId: crypto.randomUUID(),
    requestId,
    operatorId,
    targetNewHireId,
    reportId: reportId ?? null,
    privateReason,
    terminatedAt: now,
  });
  await flushTerminationEffects({ repository, portal, now });
  return {
    terminationId: recorded.termination.terminationId,
    status: recorded.status === "created" ? "terminated" : "already-terminated",
    terminatedAt: new Date(recorded.termination.terminatedAt),
  };
}

export async function reinstateNewHire({
  repository,
  portal,
  requestId,
  operatorId,
  targetNewHireId,
  privateReason,
  now = new Date(),
}: {
  repository: EmploymentRepository;
  portal: EmploymentPortalAuthority;
  requestId: string;
  operatorId: string;
  targetNewHireId: string;
  privateReason: string;
  now?: Date;
}): Promise<ReinstatementResult> {
  const recorded = await repository.recordReinstatement({
    reinstatementId: crypto.randomUUID(),
    requestId,
    operatorId,
    targetNewHireId,
    privateReason,
    reinstatedAt: now,
  });
  await flushTerminationEffects({ repository, portal, now });
  return {
    reinstatementId: recorded.reinstatement.reinstatementId,
    terminationId: recorded.reinstatement.terminationId,
    status: recorded.status === "created" ? "reinstated" : "already-reinstated",
    reinstatedAt: new Date(recorded.reinstatement.reinstatedAt),
  };
}
