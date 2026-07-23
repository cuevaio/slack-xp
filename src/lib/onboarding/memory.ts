import {
  EmploymentActionError,
  type EmploymentActionRecord,
  type EmploymentRepository,
  type PendingEmploymentEffect,
  type PendingTerminationEffect,
  type ReinstatementRecord,
  type TerminationRecord,
} from "@/lib/employment/contract";
import { employmentAccessDecision } from "@/lib/employment/domain";
import type {
  HRReportCategory,
  HRReportRepository,
  HRReportResolution,
  HRReportReviewRecord,
  HRReportState,
  HRReportSubjectType,
  MessageHRReportCategory,
  OperatorActionRecord,
  PendingHRReportNotification,
  ProfileHRReportCategory,
} from "@/lib/hr-reports/contract";
import type {
  MessageRemovalProjection,
  MessageRemovalRepository,
  PendingMessageRemovalInvalidation,
} from "@/lib/message-removals/contract";
import { planOfficeDay } from "@/lib/office-days/contract";
import type {
  OfficeDayRepository,
  ScriptedSystemEventOutboxEntry,
} from "@/lib/office-days/types";
import {
  assignJobTitle,
  getOnboardingStep,
  OnboardingError,
} from "@/lib/onboarding/domain";
import type {
  NewHireProfile,
  OnboardingRepository,
  OnboardingSnapshot,
} from "@/lib/onboarding/types";
import { officeDay } from "@/lib/portal/office-day";
import { toProfileAttribution } from "@/lib/profiles/domain";
import { createProfileInvalidationOutboxEntry } from "@/lib/profiles/outbox";
import type {
  DeletedClerkProfile,
  ProfileInvalidationOutboxEntry,
  ProfileProjectionResult,
  ProfileRepository,
  ProjectProfileOptions,
} from "@/lib/profiles/types";

type StoredProfile =
  | (NewHireProfile & { deletedAt: null })
  | DeletedClerkProfile;

type StoredOnboarding = {
  jobTitle: string;
  profileConfirmedAt: string | null;
  conductAcceptedAt: string | null;
  completedAt: string | null;
};

function hasSameProfileValues(
  current: NewHireProfile,
  candidate: NewHireProfile,
): boolean {
  return (
    current.firstName === candidate.firstName &&
    current.lastName === candidate.lastName &&
    current.displayName === candidate.displayName &&
    current.imageUrl === candidate.imageUrl
  );
}

function shouldApplyProfile(
  current: StoredProfile | undefined,
  candidate: NewHireProfile,
  options?: ProjectProfileOptions,
): boolean {
  if (!current) {
    return true;
  }

  if (current.deletedAt) {
    return (
      options?.allowTombstoneRestore === true &&
      candidate.sourceVersion > current.sourceVersion
    );
  }

  if (candidate.sourceVersion !== current.sourceVersion) {
    return candidate.sourceVersion > current.sourceVersion;
  }

  return !hasSameProfileValues(current, candidate);
}

function shouldApplyProfileTombstone(
  current: StoredProfile | undefined,
  tombstone: DeletedClerkProfile,
): boolean {
  if (!current) {
    return true;
  }

  if (current.sourceVersion !== tombstone.sourceVersion) {
    return tombstone.sourceVersion > current.sourceVersion;
  }

  return current.deletedAt === null;
}

function toSnapshot(
  profile: NewHireProfile,
  onboarding: StoredOnboarding,
): OnboardingSnapshot {
  return {
    clerkUserId: profile.clerkUserId,
    firstName: profile.firstName,
    lastName: profile.lastName,
    displayName: profile.displayName,
    imageUrl: profile.imageUrl,
    jobTitle: onboarding.jobTitle,
    profileConfirmedAt: onboarding.profileConfirmedAt,
    conductAcceptedAt: onboarding.conductAcceptedAt,
    completedAt: onboarding.completedAt,
    step: getOnboardingStep(onboarding),
  };
}

type StoredHRReport = {
  reportId: string;
  reporterId: string;
  subjectType: HRReportSubjectType;
  officeDay: string | null;
  officeChannelId: string | null;
  messageId: string | null;
  profileId: string | null;
  category: HRReportCategory;
  state: HRReportState;
  removedBy: string | null;
  removedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  subjectNewHireId: string | null;
};

type StoredMessageRemoval = MessageRemovalProjection & {
  removedBy: string;
  createdAt: Date;
};

type StoredMessageRemovalInvalidation = {
  outboxId: string;
  removalId: string;
  createdAt: Date;
  publishedAt: Date | null;
};

function toMessageRemovalProjection(
  removal: StoredMessageRemoval,
): MessageRemovalProjection {
  return {
    removalId: removal.removalId,
    officeDay: removal.officeDay,
    officeChannelId: removal.officeChannelId,
    messageId: removal.messageId,
    removedAt: new Date(removal.removedAt),
  };
}

function toHRReportResolution(
  action: OperatorActionRecord | undefined,
): HRReportResolution | null {
  if (action?.targetType !== "hr_report") return null;
  return {
    actionId: action.actionId,
    operatorId: action.operatorId,
    action: action.action,
    privateNote: action.privateNote,
    actedAt: new Date(action.actedAt),
    createdAt: new Date(action.createdAt),
  };
}

type StoredHRReportNotification = {
  outboxId: string;
  reportId: string;
  createdAt: Date;
  publishedAt: Date | null;
};

function compareHRReportsForReview(
  left: StoredHRReport,
  right: StoredHRReport,
): number {
  if (left.state !== right.state) {
    return left.state === "open" ? -1 : 1;
  }

  return right.createdAt.getTime() - left.createdAt.getTime();
}

export type InMemoryNeonRepository = OnboardingRepository &
  EmploymentRepository &
  ProfileRepository &
  OfficeDayRepository &
  HRReportRepository &
  MessageRemovalRepository & {
    recordCount(): number;
    officeDayCount(): number;
    projectionWriteCount(): number;
    profileBatchReadCount(): number;
    hrReportRecords(): readonly StoredHRReport[];
    hrReportNotificationRecords(): readonly StoredHRReportNotification[];
    operatorActionRecords(): readonly OperatorActionRecord[];
    messageRemovalRecords(): readonly StoredMessageRemoval[];
    messageRemovalInvalidationRecords(): readonly StoredMessageRemovalInvalidation[];
    employmentActionRecords(): readonly EmploymentActionRecord[];
    terminationRecords(): readonly TerminationRecord[];
    reinstatementRecords(): readonly ReinstatementRecord[];
    reset(): void;
  };

export function createInMemoryNeonRepository(
  now: () => Date = () => new Date(),
): InMemoryNeonRepository {
  const profiles = new Map<string, StoredProfile>();
  const onboardings = new Map<string, StoredOnboarding>();
  const profileOutbox = new Map<
    string,
    ProfileInvalidationOutboxEntry & { publishedAt: Date | null }
  >();
  const officeDays = new Map<string, Date>();
  const systemEventOutbox = new Map<
    string,
    ScriptedSystemEventOutboxEntry & { publishedAt: Date | null }
  >();
  const hrReports = new Map<string, StoredHRReport>();
  const hrReportNotifications = new Map<string, StoredHRReportNotification>();
  const operatorActionsByTarget = new Map<string, OperatorActionRecord>();
  const messageRemovals = new Map<string, StoredMessageRemoval>();
  const messageRemovalInvalidations = new Map<
    string,
    StoredMessageRemovalInvalidation
  >();
  const employmentActions = new Map<string, EmploymentActionRecord>();
  const employmentActionsByRequestId = new Map<string, string>();
  const employmentEffects = new Map<string, PendingEmploymentEffect>();
  const employmentOperatorActions = new Map<string, OperatorActionRecord>();
  const terminations = new Map<string, TerminationRecord>();
  const terminationRequests = new Map<string, string>();
  const reinstatements = new Map<string, ReinstatementRecord>();
  const reinstatementRequests = new Map<string, string>();
  const terminationEffects = new Map<string, PendingTerminationEffect>();
  let projectionWrites = 0;
  let profileBatchReads = 0;

  function requireOnboarding(clerkUserId: string): StoredOnboarding {
    const onboarding = onboardings.get(clerkUserId);
    if (!onboarding) {
      throw new OnboardingError(
        "onboarding_not_found",
        "Start New Employee Setup before continuing.",
      );
    }
    return onboarding;
  }

  function requireProfile(clerkUserId: string): NewHireProfile {
    const profile = profiles.get(clerkUserId);
    if (!profile || profile.deletedAt) {
      throw new OnboardingError(
        "onboarding_not_found",
        "Start New Employee Setup before continuing.",
      );
    }
    return profile;
  }

  function hasCurrentProfile(clerkUserId: string): boolean {
    const profile = profiles.get(clerkUserId);
    return Boolean(profile && !profile.deletedAt);
  }

  function applyProfileProjection(
    profile: NewHireProfile,
    options?: ProjectProfileOptions,
  ): ProfileProjectionResult {
    const current = profiles.get(profile.clerkUserId);
    if (!shouldApplyProfile(current, profile, options)) {
      return "unchanged";
    }

    profiles.set(profile.clerkUserId, { ...profile, deletedAt: null });
    const outboxEntry = createProfileInvalidationOutboxEntry(profile, now());
    profileOutbox.set(outboxEntry.outboxId, {
      ...outboxEntry,
      publishedAt: null,
    });
    projectionWrites += 1;
    return "applied";
  }

  function applyProfileTombstone(
    tombstone: DeletedClerkProfile,
  ): ProfileProjectionResult {
    const current = profiles.get(tombstone.clerkUserId);
    if (!shouldApplyProfileTombstone(current, tombstone)) {
      return "unchanged";
    }

    profiles.set(tombstone.clerkUserId, {
      ...tombstone,
      deletedAt: new Date(tombstone.deletedAt),
    });
    const outboxEntry = createProfileInvalidationOutboxEntry(tombstone, now());
    profileOutbox.set(outboxEntry.outboxId, {
      ...outboxEntry,
      publishedAt: null,
    });
    projectionWrites += 1;
    return "applied";
  }

  return {
    async seedOfficeDay(currentOfficeDay, seededAt) {
      if (officeDays.has(currentOfficeDay)) {
        return 0;
      }
      const planned = planOfficeDay(currentOfficeDay);
      officeDays.set(currentOfficeDay, new Date(seededAt));
      for (const entry of planned) {
        systemEventOutbox.set(entry.eventKey, {
          ...entry,
          dueAt: new Date(entry.dueAt),
          attemptCount: 0,
          lastAttemptAt: null,
          publishedAt: null,
        });
      }
      return planned.length;
    },

    async pendingSystemEvents(currentOfficeDay, dueAt, limit) {
      return [...systemEventOutbox.values()]
        .filter(
          (entry) =>
            entry.officeDay === currentOfficeDay &&
            entry.publishedAt === null &&
            entry.dueAt <= dueAt,
        )
        .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
        .slice(0, limit)
        .map(({ publishedAt: _publishedAt, ...entry }) => ({ ...entry }));
    },

    async markSystemEventAttempt(eventKey, attemptedAt) {
      const entry = systemEventOutbox.get(eventKey);
      if (entry && entry.publishedAt === null) {
        entry.attemptCount += 1;
        entry.lastAttemptAt = new Date(attemptedAt);
      }
    },

    async markSystemEventPublished(eventKey, publishedAt) {
      const entry = systemEventOutbox.get(eventKey);
      if (entry && entry.publishedAt === null && entry.lastAttemptAt !== null) {
        entry.publishedAt = new Date(publishedAt);
      }
    },

    async projectProfile(profile, options) {
      return applyProfileProjection(profile, options);
    },

    async tombstoneProfile(tombstone) {
      return applyProfileTombstone(tombstone);
    },

    async getProfiles(clerkUserIds) {
      profileBatchReads += 1;
      return clerkUserIds.map((clerkUserId) =>
        toProfileAttribution(clerkUserId, profiles.get(clerkUserId)),
      );
    },

    async pendingProfileInvalidations(limit) {
      return [...profileOutbox.values()]
        .filter(({ publishedAt }) => publishedAt === null)
        .slice(0, limit)
        .map(({ outboxId, event }) => ({ outboxId, event }));
    },

    async markProfileInvalidationPublished(outboxId, publishedAt) {
      const entry = profileOutbox.get(outboxId);
      if (entry && entry.publishedAt === null) {
        entry.publishedAt = publishedAt;
      }
    },

    async createHRReport(input) {
      const existing = [...hrReports.values()].find(
        (report) =>
          report.reporterId === input.reporterId &&
          report.subjectType === input.subjectType &&
          (input.subjectType === "message"
            ? report.officeChannelId === input.officeChannelId &&
              report.messageId === input.messageId
            : report.profileId === input.profileId) &&
          report.state === "open",
      );
      if (existing) {
        return { reportId: existing.reportId, status: "already-reported" };
      }
      const report: StoredHRReport = {
        reportId: input.reportId,
        reporterId: input.reporterId,
        subjectType: input.subjectType,
        officeDay: input.subjectType === "message" ? input.officeDay : null,
        officeChannelId:
          input.subjectType === "message" ? input.officeChannelId : null,
        messageId: input.subjectType === "message" ? input.messageId : null,
        profileId: input.subjectType === "profile" ? input.profileId : null,
        subjectNewHireId:
          input.subjectNewHireId ??
          (input.subjectType === "profile" ? input.profileId : null),
        category: input.category,
        state: "open",
        removedBy: null,
        removedAt: null,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
      const outboxId = `hr-report-notification:${input.reportId}`;
      hrReports.set(report.reportId, report);
      hrReportNotifications.set(outboxId, {
        outboxId,
        reportId: report.reportId,
        createdAt: input.createdAt,
        publishedAt: null,
      });
      return { reportId: report.reportId, status: "created" };
    },

    async pendingHRReportNotifications(limit) {
      const entries = [...hrReportNotifications.values()]
        .filter(({ publishedAt }) => publishedAt === null)
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, limit);
      const pending: PendingHRReportNotification[] = [];
      for (const entry of entries) {
        const report = hrReports.get(entry.reportId);
        if (report?.state !== "open") continue;
        if (report?.subjectType === "profile" && report.profileId) {
          pending.push({
            outboxId: entry.outboxId,
            subjectType: "profile",
            profileId: report.profileId,
          });
        } else if (
          report?.subjectType === "message" &&
          report.officeDay &&
          report.officeChannelId &&
          report.messageId
        ) {
          pending.push({
            outboxId: entry.outboxId,
            subjectType: "message",
            officeDay: report.officeDay,
            officeChannelId: report.officeChannelId,
            messageId: report.messageId,
          });
        }
      }
      return pending;
    },

    async markHRReportNotificationPublished(outboxId, publishedAt) {
      const entry = hrReportNotifications.get(outboxId);
      if (entry && entry.publishedAt === null) {
        entry.publishedAt = publishedAt;
      }
    },

    async listHRReports(limit) {
      return [...hrReports.values()]
        .sort(compareHRReportsForReview)
        .slice(0, limit)
        .flatMap((report): HRReportReviewRecord[] => {
          const resolution = operatorActionsByTarget.get(
            `hr_report:${report.reportId}`,
          );
          const shared = {
            reportId: report.reportId,
            reporterId: report.reporterId,
            state: report.state,
            createdAt: new Date(report.createdAt),
            updatedAt: new Date(report.updatedAt),
            resolution: toHRReportResolution(resolution),
            subjectNewHireId: report.subjectNewHireId,
          };
          if (
            report.subjectType === "message" &&
            report.officeDay &&
            report.officeChannelId &&
            report.messageId
          ) {
            return [
              {
                ...shared,
                subjectType: "message",
                officeDay: report.officeDay,
                officeChannelId: report.officeChannelId,
                messageId: report.messageId,
                category: report.category as MessageHRReportCategory,
              },
            ];
          }
          if (report.subjectType === "profile" && report.profileId) {
            return [
              {
                ...shared,
                subjectType: "profile",
                profileId: report.profileId,
                category: report.category as ProfileHRReportCategory,
              },
            ];
          }
          return [];
        });
    },

    async dismissHRReport(input) {
      const report = hrReports.get(input.reportId);
      if (!report) return null;
      if (report.state !== "open") {
        const current = (await this.listHRReports(50)).find(
          ({ reportId }) => reportId === input.reportId,
        );
        return current
          ? { status: "already-dismissed", report: current }
          : null;
      }
      report.state = "dismissed";
      report.updatedAt = new Date(input.actedAt);
      operatorActionsByTarget.set(`hr_report:${report.reportId}`, {
        actionId: input.actionId,
        operatorId: input.operatorId,
        targetType: "hr_report",
        targetId: report.reportId,
        action: "dismissed",
        privateNote: input.privateNote,
        actedAt: new Date(input.actedAt),
        createdAt: new Date(input.actedAt),
      });
      const current = (await this.listHRReports(50)).find(
        ({ reportId }) => reportId === input.reportId,
      );
      return current ? { status: "dismissed", report: current } : null;
    },

    async createMessageRemoval(input) {
      const existing = [...messageRemovals.values()].find(
        (removal) =>
          removal.officeChannelId === input.officeChannelId &&
          removal.messageId === input.messageId,
      );
      if (existing) {
        return {
          status: "already-removed",
          removal: toMessageRemovalProjection(existing),
        };
      }

      const removal: StoredMessageRemoval = {
        removalId: input.removalId,
        officeDay: input.officeDay,
        officeChannelId: input.officeChannelId,
        messageId: input.messageId,
        removedBy: input.operatorId,
        removedAt: new Date(input.removedAt),
        createdAt: new Date(input.removedAt),
      };
      messageRemovals.set(removal.removalId, removal);
      for (const report of hrReports.values()) {
        if (
          report.state === "open" &&
          report.subjectType === "message" &&
          report.officeChannelId === removal.officeChannelId &&
          report.messageId === removal.messageId
        ) {
          report.state = "removed";
          report.removedBy = removal.removedBy;
          report.removedAt = new Date(removal.removedAt);
          report.updatedAt = new Date(removal.removedAt);
        }
      }
      operatorActionsByTarget.set(`message_removal:${removal.removalId}`, {
        actionId: input.actionId,
        operatorId: removal.removedBy,
        targetType: "message_removal",
        targetId: removal.removalId,
        action: "removed",
        privateNote: input.privateReason,
        actedAt: new Date(removal.removedAt),
        createdAt: new Date(removal.removedAt),
      });
      const outboxId = `message-removal:${removal.removalId}`;
      messageRemovalInvalidations.set(outboxId, {
        outboxId,
        removalId: removal.removalId,
        createdAt: new Date(removal.removedAt),
        publishedAt: null,
      });
      return {
        status: "removed",
        removal: toMessageRemovalProjection(removal),
      };
    },

    async listMessageRemovals(officeChannelId) {
      return [...messageRemovals.values()]
        .filter((removal) => removal.officeChannelId === officeChannelId)
        .map(toMessageRemovalProjection);
    },

    async pendingMessageRemovalInvalidations(limit) {
      const pending: PendingMessageRemovalInvalidation[] = [];
      for (const entry of [...messageRemovalInvalidations.values()]
        .filter(({ publishedAt }) => publishedAt === null)
        .sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        )
        .slice(0, limit)) {
        const removal = messageRemovals.get(entry.removalId);
        if (removal) {
          pending.push({
            outboxId: entry.outboxId,
            removalId: removal.removalId,
            messageId: removal.messageId,
            occurredAt: new Date(removal.removedAt),
          });
        }
      }
      return pending;
    },

    async markMessageRemovalInvalidationPublished(outboxId, publishedAt) {
      const entry = messageRemovalInvalidations.get(outboxId);
      if (entry && entry.publishedAt === null) {
        entry.publishedAt = new Date(publishedAt);
      }
    },

    async recordSendHome(input) {
      const target = profiles.get(input.targetNewHireId);
      if (!target || target.deletedAt) {
        throw new EmploymentActionError(
          "new_hire_not_found",
          "The requested New Hire does not exist.",
        );
      }
      const requestActionId = employmentActionsByRequestId.get(input.requestId);
      if (requestActionId) {
        const requestAction = employmentActions.get(requestActionId);
        if (
          !requestAction ||
          requestAction.targetNewHireId !== input.targetNewHireId
        ) {
          throw new EmploymentActionError(
            "request_conflict",
            "The Send Home request was already used for another target.",
          );
        }
        return { status: "existing", action: { ...requestAction } };
      }

      const report = input.reportId ? hrReports.get(input.reportId) : undefined;
      const reportTarget = report
        ? (report.subjectNewHireId ??
          (report.subjectType === "profile" ? report.profileId : null))
        : null;
      if (
        input.reportId &&
        (!report || reportTarget !== input.targetNewHireId)
      ) {
        throw new EmploymentActionError(
          "report_not_found",
          "The HR Report does not match the requested New Hire.",
        );
      }

      const existing = [...employmentActions.values()].find(
        (action) =>
          action.targetNewHireId === input.targetNewHireId &&
          action.officeDay === input.officeDay,
      );
      if (existing) {
        employmentActionsByRequestId.set(input.requestId, existing.actionId);
        if (report?.state === "open") {
          report.state = "actioned";
          report.updatedAt = new Date(input.actedAt);
        }
        return { status: "existing", action: { ...existing } };
      }

      const action: EmploymentActionRecord = {
        actionId: input.actionId,
        requestId: input.requestId,
        action: "sent_home",
        operatorId: input.operatorId,
        targetNewHireId: input.targetNewHireId,
        officeDay: input.officeDay,
        expiresAt: new Date(input.expiresAt),
        reportId: input.reportId,
        actedAt: new Date(input.actedAt),
        createdAt: new Date(input.actedAt),
      };
      employmentActions.set(action.actionId, action);
      employmentActionsByRequestId.set(action.requestId, action.actionId);
      employmentEffects.set(action.actionId, {
        ...action,
        bansAppliedAt: null,
        publicEventPublishedAt: null,
        invalidationPublishedAt: null,
      });
      employmentOperatorActions.set(action.actionId, {
        actionId: action.actionId,
        operatorId: action.operatorId,
        targetType: "new_hire",
        targetId: action.targetNewHireId,
        action: "sent_home",
        privateNote: input.privateReason,
        actedAt: new Date(action.actedAt),
        createdAt: new Date(action.createdAt),
      });
      if (report?.state === "open") {
        report.state = "actioned";
        report.updatedAt = new Date(input.actedAt);
      }
      return { status: "created", action: { ...action } };
    },

    async getEmploymentAccess(newHireId, checkedAt) {
      const profile = profiles.get(newHireId);
      const active = [...employmentActions.values()]
        .filter(
          (action) =>
            action.targetNewHireId === newHireId &&
            action.expiresAt.getTime() > checkedAt.getTime(),
        )
        .sort(
          (left, right) => right.expiresAt.getTime() - left.expiresAt.getTime(),
        )[0];
      return employmentAccessDecision({
        now: checkedAt,
        sentHomeUntil: active?.expiresAt ?? null,
        terminatedAt:
          [...terminations.values()].find(
            (termination) =>
              termination.targetNewHireId === newHireId &&
              termination.reinstatedAt === null,
          )?.terminatedAt ?? null,
        deletedAt: profile ? profile.deletedAt : checkedAt,
      });
    },

    async recordTermination(input) {
      if (!hasCurrentProfile(input.targetNewHireId)) {
        throw new EmploymentActionError(
          "new_hire_not_found",
          "The requested New Hire does not exist.",
        );
      }
      const requestedId = terminationRequests.get(input.requestId);
      if (requestedId) {
        const requested = terminations.get(requestedId);
        if (!requested || requested.targetNewHireId !== input.targetNewHireId) {
          throw new EmploymentActionError(
            "request_conflict",
            "The Termination request was already used for another target.",
          );
        }
        return { status: "existing" as const, termination: { ...requested } };
      }
      const report = input.reportId ? hrReports.get(input.reportId) : undefined;
      const reportTarget = report
        ? (report.subjectNewHireId ??
          (report.subjectType === "profile" ? report.profileId : null))
        : null;
      if (
        input.reportId &&
        (!report || reportTarget !== input.targetNewHireId)
      ) {
        throw new EmploymentActionError(
          "report_not_found",
          "The HR Report does not match the requested New Hire.",
        );
      }
      const existing = [...terminations.values()].find(
        (termination) =>
          termination.targetNewHireId === input.targetNewHireId &&
          termination.reinstatedAt === null,
      );
      if (existing) {
        terminationRequests.set(input.requestId, existing.terminationId);
        if (report?.state === "open") {
          report.state = "actioned";
          report.updatedAt = new Date(input.terminatedAt);
        }
        return { status: "existing" as const, termination: { ...existing } };
      }
      const termination: TerminationRecord = {
        terminationId: input.terminationId,
        requestId: input.requestId,
        operatorId: input.operatorId,
        targetNewHireId: input.targetNewHireId,
        reportId: input.reportId,
        terminatedAt: new Date(input.terminatedAt),
        reinstatedAt: null,
        createdAt: new Date(input.terminatedAt),
      };
      terminations.set(termination.terminationId, termination);
      terminationRequests.set(termination.requestId, termination.terminationId);
      terminationEffects.set(termination.terminationId, {
        effectId: termination.terminationId,
        action: "terminated",
        operatorId: termination.operatorId,
        targetNewHireId: termination.targetNewHireId,
        terminationId: termination.terminationId,
        officeDay: officeDay(termination.terminatedAt),
        actedAt: new Date(termination.terminatedAt),
        portalAccessReconciledAt: null,
        publicEventPublishedAt: null,
        invalidationPublishedAt: null,
      });
      employmentOperatorActions.set(termination.terminationId, {
        actionId: termination.terminationId,
        operatorId: termination.operatorId,
        targetType: "new_hire",
        targetId: termination.targetNewHireId,
        action: "terminated",
        privateNote: input.privateReason,
        actedAt: new Date(termination.terminatedAt),
        createdAt: new Date(termination.createdAt),
      });
      if (report?.state === "open") {
        report.state = "actioned";
        report.updatedAt = new Date(input.terminatedAt);
      }
      return { status: "created" as const, termination: { ...termination } };
    },

    async recordReinstatement(input) {
      if (!hasCurrentProfile(input.targetNewHireId)) {
        throw new EmploymentActionError(
          "new_hire_deleted",
          "A deleted New Hire cannot be reinstated.",
        );
      }
      const requestedId = reinstatementRequests.get(input.requestId);
      if (requestedId) {
        const requested = reinstatements.get(requestedId);
        if (!requested || requested.targetNewHireId !== input.targetNewHireId) {
          throw new EmploymentActionError(
            "request_conflict",
            "The reinstatement request was already used for another target.",
          );
        }
        return { status: "existing" as const, reinstatement: { ...requested } };
      }
      const termination = [...terminations.values()].find(
        (candidate) =>
          candidate.targetNewHireId === input.targetNewHireId &&
          candidate.reinstatedAt === null,
      );
      if (!termination) {
        throw new EmploymentActionError(
          "termination_not_found",
          "The New Hire has no active Termination.",
        );
      }
      const existing = [...reinstatements.values()].find(
        (candidate) => candidate.terminationId === termination.terminationId,
      );
      if (existing) {
        reinstatementRequests.set(input.requestId, existing.reinstatementId);
        return { status: "existing" as const, reinstatement: { ...existing } };
      }
      termination.reinstatedAt = new Date(input.reinstatedAt);
      const reinstatement: ReinstatementRecord = {
        reinstatementId: input.reinstatementId,
        requestId: input.requestId,
        terminationId: termination.terminationId,
        operatorId: input.operatorId,
        targetNewHireId: input.targetNewHireId,
        reinstatedAt: new Date(input.reinstatedAt),
        createdAt: new Date(input.reinstatedAt),
      };
      reinstatements.set(reinstatement.reinstatementId, reinstatement);
      reinstatementRequests.set(
        reinstatement.requestId,
        reinstatement.reinstatementId,
      );
      terminationEffects.set(reinstatement.reinstatementId, {
        effectId: reinstatement.reinstatementId,
        action: "reinstated",
        operatorId: reinstatement.operatorId,
        targetNewHireId: reinstatement.targetNewHireId,
        terminationId: reinstatement.terminationId,
        officeDay: officeDay(reinstatement.reinstatedAt),
        actedAt: new Date(reinstatement.reinstatedAt),
        portalAccessReconciledAt: null,
        publicEventPublishedAt: null,
        invalidationPublishedAt: null,
      });
      employmentOperatorActions.set(reinstatement.reinstatementId, {
        actionId: reinstatement.reinstatementId,
        operatorId: reinstatement.operatorId,
        targetType: "new_hire",
        targetId: reinstatement.targetNewHireId,
        action: "reinstated",
        privateNote: input.privateReason,
        actedAt: new Date(reinstatement.reinstatedAt),
        createdAt: new Date(reinstatement.createdAt),
      });
      return {
        status: "created" as const,
        reinstatement: { ...reinstatement },
      };
    },

    async getEmploymentState(newHireId, checkedAt) {
      const activeTermination = [...terminations.values()].find(
        (termination) =>
          termination.targetNewHireId === newHireId &&
          termination.reinstatedAt === null,
      );
      return {
        access: await this.getEmploymentAccess(newHireId, checkedAt),
        activeTermination: activeTermination
          ? {
              terminationId: activeTermination.terminationId,
              operatorId: activeTermination.operatorId,
              terminatedAt: new Date(activeTermination.terminatedAt),
            }
          : null,
      };
    },

    async pendingTerminationEffects(limit) {
      return [...terminationEffects.values()]
        .filter(
          (effect) =>
            !effect.portalAccessReconciledAt ||
            !effect.publicEventPublishedAt ||
            !effect.invalidationPublishedAt,
        )
        .slice(0, limit)
        .map((effect) => ({ ...effect }));
    },

    async markTerminationPortalAccessReconciled(effectId, reconciledAt) {
      const effect = terminationEffects.get(effectId);
      if (effect && !effect.portalAccessReconciledAt) {
        effect.portalAccessReconciledAt = new Date(reconciledAt);
      }
    },

    async markTerminationPublicEventPublished(effectId, publishedAt) {
      const effect = terminationEffects.get(effectId);
      if (effect && !effect.publicEventPublishedAt) {
        effect.publicEventPublishedAt = new Date(publishedAt);
      }
    },

    async markTerminationInvalidationPublished(effectId, publishedAt) {
      const effect = terminationEffects.get(effectId);
      if (effect && !effect.invalidationPublishedAt) {
        effect.invalidationPublishedAt = new Date(publishedAt);
      }
    },

    async pendingEmploymentEffects(limit) {
      return [...employmentEffects.values()]
        .filter(
          (effect) =>
            !effect.bansAppliedAt ||
            !effect.publicEventPublishedAt ||
            !effect.invalidationPublishedAt,
        )
        .slice(0, limit)
        .map((effect) => ({ ...effect }));
    },

    async markEmploymentBansApplied(actionId, appliedAt) {
      const effect = employmentEffects.get(actionId);
      if (effect && !effect.bansAppliedAt)
        effect.bansAppliedAt = new Date(appliedAt);
    },

    async markEmploymentPublicEventPublished(actionId, publishedAt) {
      const effect = employmentEffects.get(actionId);
      if (effect && !effect.publicEventPublishedAt) {
        effect.publicEventPublishedAt = new Date(publishedAt);
      }
    },

    async markEmploymentInvalidationPublished(actionId, publishedAt) {
      const effect = employmentEffects.get(actionId);
      if (effect && !effect.invalidationPublishedAt) {
        effect.invalidationPublishedAt = new Date(publishedAt);
      }
    },

    async enterNewHire(profile) {
      applyProfileProjection(profile);
      let onboarding = onboardings.get(profile.clerkUserId);
      if (!onboarding) {
        onboarding = {
          jobTitle: assignJobTitle(profile.clerkUserId),
          profileConfirmedAt: null,
          conductAcceptedAt: null,
          completedAt: null,
        };
        onboardings.set(profile.clerkUserId, onboarding);
      }
      return toSnapshot(requireProfile(profile.clerkUserId), onboarding);
    },

    async confirmProfile(clerkUserId) {
      const onboarding = requireOnboarding(clerkUserId);
      onboarding.profileConfirmedAt ??= now().toISOString();
      return toSnapshot(requireProfile(clerkUserId), onboarding);
    },

    async acceptConduct(clerkUserId) {
      const onboarding = requireOnboarding(clerkUserId);
      if (!onboarding.profileConfirmedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Confirm your New Hire Profile before accepting the conduct policy.",
        );
      }
      onboarding.conductAcceptedAt ??= now().toISOString();
      return toSnapshot(requireProfile(clerkUserId), onboarding);
    },

    async clockIn(clerkUserId) {
      const onboarding = requireOnboarding(clerkUserId);
      if (!onboarding.profileConfirmedAt || !onboarding.conductAcceptedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Complete your profile and accept the code of conduct before Clock In.",
        );
      }
      onboarding.completedAt ??= now().toISOString();
      return toSnapshot(requireProfile(clerkUserId), onboarding);
    },

    async getNewHire(clerkUserId) {
      const profile = profiles.get(clerkUserId);
      const onboarding = onboardings.get(clerkUserId);
      return profile && !profile.deletedAt && onboarding
        ? toSnapshot(profile, onboarding)
        : null;
    },

    recordCount() {
      return onboardings.size;
    },

    officeDayCount() {
      return officeDays.size;
    },

    projectionWriteCount() {
      return projectionWrites;
    },

    profileBatchReadCount() {
      return profileBatchReads;
    },

    hrReportRecords() {
      return [...hrReports.values()];
    },

    hrReportNotificationRecords() {
      return [...hrReportNotifications.values()];
    },

    operatorActionRecords() {
      return [
        ...operatorActionsByTarget.values(),
        ...employmentOperatorActions.values(),
      ];
    },

    messageRemovalRecords() {
      return [...messageRemovals.values()];
    },

    messageRemovalInvalidationRecords() {
      return [...messageRemovalInvalidations.values()];
    },

    employmentActionRecords() {
      return [...employmentActions.values()];
    },

    terminationRecords() {
      return [...terminations.values()];
    },

    reinstatementRecords() {
      return [...reinstatements.values()];
    },

    reset() {
      profiles.clear();
      onboardings.clear();
      profileOutbox.clear();
      officeDays.clear();
      systemEventOutbox.clear();
      hrReports.clear();
      hrReportNotifications.clear();
      operatorActionsByTarget.clear();
      messageRemovals.clear();
      messageRemovalInvalidations.clear();
      employmentActions.clear();
      employmentActionsByRequestId.clear();
      employmentEffects.clear();
      employmentOperatorActions.clear();
      terminations.clear();
      terminationRequests.clear();
      reinstatements.clear();
      reinstatementRequests.clear();
      terminationEffects.clear();
      projectionWrites = 0;
      profileBatchReads = 0;
    },
  };
}
