import type {
  HRReportCategory,
  HRReportRepository,
  HRReportReviewRecord,
  HRReportState,
  HRReportSubjectType,
  MessageHRReportCategory,
  OperatorActionRecord,
  PendingHRReportNotification,
  ProfileHRReportCategory,
} from "@/lib/hr-reports/contract";
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
import { toProfileAttribution } from "@/lib/profiles/domain";
import { createProfileInvalidationOutboxEntry } from "@/lib/profiles/outbox";
import type {
  ProfileInvalidationOutboxEntry,
  ProfileProjectionResult,
  ProfileRepository,
} from "@/lib/profiles/types";

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
  current: NewHireProfile | undefined,
  candidate: NewHireProfile,
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.sourceVersion !== current.sourceVersion) {
    return candidate.sourceVersion > current.sourceVersion;
  }

  return !hasSameProfileValues(current, candidate);
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
  createdAt: Date;
  updatedAt: Date;
};

type StoredHRReportNotification = {
  outboxId: string;
  reportId: string;
  createdAt: Date;
  publishedAt: Date | null;
};

export type InMemoryNeonRepository = OnboardingRepository &
  ProfileRepository &
  OfficeDayRepository &
  HRReportRepository & {
    recordCount(): number;
    officeDayCount(): number;
    projectionWriteCount(): number;
    profileBatchReadCount(): number;
    hrReportRecords(): readonly StoredHRReport[];
    hrReportNotificationRecords(): readonly StoredHRReportNotification[];
    operatorActionRecords(): readonly OperatorActionRecord[];
    reset(): void;
  };

export function createInMemoryNeonRepository(
  now: () => Date = () => new Date(),
): InMemoryNeonRepository {
  const profiles = new Map<string, NewHireProfile>();
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
  const operatorActions = new Map<string, OperatorActionRecord>();
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
    if (!profile) {
      throw new OnboardingError(
        "onboarding_not_found",
        "Start New Employee Setup before continuing.",
      );
    }
    return profile;
  }

  function applyProfileProjection(
    profile: NewHireProfile,
  ): ProfileProjectionResult {
    const current = profiles.get(profile.clerkUserId);
    if (!shouldApplyProfile(current, profile)) {
      return "unchanged";
    }

    profiles.set(profile.clerkUserId, { ...profile });
    const outboxEntry = createProfileInvalidationOutboxEntry(profile, now());
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

    async projectProfile(profile) {
      return applyProfileProjection(profile);
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
        category: input.category,
        state: "open",
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
        .sort(
          (left, right) =>
            (left.state === right.state ? 0 : left.state === "open" ? -1 : 1) ||
            right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .slice(0, limit)
        .flatMap((report): HRReportReviewRecord[] => {
          const resolution = [...operatorActions.values()].find(
            (action) => action.targetId === report.reportId,
          );
          const shared = {
            reportId: report.reportId,
            reporterId: report.reporterId,
            category: report.category,
            state: report.state,
            createdAt: new Date(report.createdAt),
            updatedAt: new Date(report.updatedAt),
            resolution: resolution
              ? {
                  actionId: resolution.actionId,
                  operatorId: resolution.operatorId,
                  action: resolution.action,
                  privateNote: resolution.privateNote,
                  actedAt: new Date(resolution.actedAt),
                  createdAt: new Date(resolution.createdAt),
                }
              : null,
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
      if (report.state === "dismissed") {
        const current = (await this.listHRReports(50)).find(
          ({ reportId }) => reportId === input.reportId,
        );
        return current
          ? { status: "already-dismissed", report: current }
          : null;
      }
      report.state = "dismissed";
      report.updatedAt = new Date(input.actedAt);
      operatorActions.set(report.reportId, {
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
      return profile && onboarding ? toSnapshot(profile, onboarding) : null;
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
      return [...operatorActions.values()];
    },

    reset() {
      profiles.clear();
      onboardings.clear();
      profileOutbox.clear();
      officeDays.clear();
      systemEventOutbox.clear();
      hrReports.clear();
      hrReportNotifications.clear();
      operatorActions.clear();
      projectionWrites = 0;
      profileBatchReads = 0;
    },
  };
}
