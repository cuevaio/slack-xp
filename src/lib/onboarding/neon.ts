import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import type { NeonAdapter } from "@/lib/adapters/types";
import type { Database } from "@/lib/db/client";
import {
  clerkProfiles,
  hrReportNotificationOutbox,
  hrReports,
  messageRemovalInvalidationOutbox,
  messageRemovals,
  newHireOnboarding,
  officeDays,
  operatorActions,
  profileInvalidationOutbox,
  scriptedSystemEventOutbox,
} from "@/lib/db/schema";
import type {
  CreateHRReportInput,
  DismissHRReportInput,
  HRReportResolution,
  HRReportReviewRecord,
  MessageHRReportCategory,
  PendingHRReportNotification,
  ProfileHRReportCategory,
} from "@/lib/hr-reports/contract";
import type {
  CreateMessageRemovalInput,
  PendingMessageRemovalInvalidation,
} from "@/lib/message-removals/contract";
import {
  type PlannedSystemEvent,
  planOfficeDay,
} from "@/lib/office-days/contract";
import type { ScriptedSystemEventOutboxEntry } from "@/lib/office-days/types";
import { OFFICE_EVENT_VERSION } from "@/lib/office-events/contract";
import {
  assignJobTitle,
  getOnboardingStep,
  OnboardingError,
} from "@/lib/onboarding/domain";
import type {
  NewHireProfile,
  OnboardingSnapshot,
} from "@/lib/onboarding/types";
import { toProfileAttribution } from "@/lib/profiles/domain";
import { createProfileInvalidationOutboxEntry } from "@/lib/profiles/outbox";
import type {
  ProfileAttribution,
  ProfileInvalidationOutboxEntry,
} from "@/lib/profiles/types";

type OnboardingRow = {
  clerkUserId: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  imageUrl: string | null;
  jobTitle: string;
  profileConfirmedAt: Date | null;
  conductAcceptedAt: Date | null;
  completedAt: Date | null;
};

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toSnapshot(row: OnboardingRow): OnboardingSnapshot {
  if (!row.firstName || row.lastName === null || !row.displayName) {
    throw new OnboardingError(
      "onboarding_incomplete",
      "A tombstoned or invalid Clerk profile cannot enter the Office Day.",
    );
  }
  const timestamps = {
    profileConfirmedAt: toIsoString(row.profileConfirmedAt),
    conductAcceptedAt: toIsoString(row.conductAcceptedAt),
    completedAt: toIsoString(row.completedAt),
  };
  return {
    clerkUserId: row.clerkUserId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    jobTitle: row.jobTitle,
    ...timestamps,
    step: getOnboardingStep(timestamps),
  };
}

export function buildProfileProjectionQuery(
  database: Database,
  profile: NewHireProfile,
) {
  return database
    .insert(clerkProfiles)
    .values(profile)
    .onConflictDoUpdate({
      target: clerkProfiles.clerkUserId,
      set: {
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName: profile.displayName,
        imageUrl: profile.imageUrl,
        sourceVersion: profile.sourceVersion,
        updatedAt: new Date(),
      },
      // A newer webhook always wins. Equal-version repair may correct drift,
      // but an exact replay performs no write and leaves updated_at stable.
      setWhere: sql`
        ${clerkProfiles.sourceVersion} < excluded.source_version
        or (
          ${clerkProfiles.sourceVersion} = excluded.source_version
          and (
            ${clerkProfiles.firstName} is distinct from excluded.first_name
            or ${clerkProfiles.lastName} is distinct from excluded.last_name
            or ${clerkProfiles.displayName} is distinct from excluded.display_name
            or ${clerkProfiles.imageUrl} is distinct from excluded.image_url
          )
        )
      `,
    })
    .returning({ clerkUserId: clerkProfiles.clerkUserId });
}

export function buildProfileOutboxQuery(
  database: Database,
  profile: NewHireProfile,
  occurredAt: Date,
) {
  const outboxEntry = createProfileInvalidationOutboxEntry(profile, occurredAt);
  return database
    .insert(profileInvalidationOutbox)
    .select(
      database
        .select({
          eventKey: sql<string>`${outboxEntry.event.eventKey}`.as("event_key"),
          profileId: clerkProfiles.clerkUserId,
          occurredAt: sql<Date>`${occurredAt}`.as("occurred_at"),
          publishedAt: sql<Date | null>`null`.as("published_at"),
          createdAt: sql<Date>`${occurredAt}`.as("created_at"),
        })
        .from(clerkProfiles)
        .where(
          and(
            eq(clerkProfiles.clerkUserId, profile.clerkUserId),
            eq(clerkProfiles.sourceVersion, profile.sourceVersion),
            eq(clerkProfiles.firstName, profile.firstName),
            eq(clerkProfiles.lastName, profile.lastName),
            eq(clerkProfiles.displayName, profile.displayName),
            profile.imageUrl === null
              ? isNull(clerkProfiles.imageUrl)
              : eq(clerkProfiles.imageUrl, profile.imageUrl),
          ),
        ),
    )
    .onConflictDoNothing({ target: profileInvalidationOutbox.eventKey });
}

export function buildOfficeDayQueries(
  database: Database,
  currentOfficeDay: string,
  seededAt: Date,
) {
  const planned = planOfficeDay(currentOfficeDay);
  return [
    database
      .insert(officeDays)
      .values({
        officeDay: currentOfficeDay,
        seededAt,
        createdAt: seededAt,
      })
      .onConflictDoNothing({ target: officeDays.officeDay }),
    database
      .insert(scriptedSystemEventOutbox)
      .values(
        planned.map((entry) => ({
          eventKey: entry.eventKey,
          officeDay: entry.officeDay,
          scriptId: entry.scriptId,
          channelId: entry.channelId,
          characterId: entry.characterId,
          dueAt: entry.dueAt,
          createdAt: seededAt,
        })),
      )
      .onConflictDoNothing({ target: scriptedSystemEventOutbox.eventKey }),
  ] as const;
}

type StoredSystemEventReference = {
  scriptId: string;
  channelId: string;
  characterId: string;
  dueAt: Date;
};

function matchesPlannedSystemEvent(
  stored: StoredSystemEventReference,
  planned: PlannedSystemEvent | undefined,
): planned is PlannedSystemEvent {
  return (
    planned !== undefined &&
    planned.scriptId === stored.scriptId &&
    planned.channelId === stored.channelId &&
    planned.characterId === stored.characterId &&
    planned.dueAt.getTime() === stored.dueAt.getTime()
  );
}

function hrReportSubjectColumns(input: CreateHRReportInput) {
  if (input.subjectType === "profile") {
    return {
      officeDay: null,
      officeChannelId: null,
      messageId: null,
      profileId: input.profileId,
    };
  }

  return {
    officeDay: input.officeDay,
    officeChannelId: input.officeChannelId,
    messageId: input.messageId,
    profileId: null,
  };
}

export function buildHRReportInsertQuery(
  database: Database,
  input: CreateHRReportInput,
) {
  const query = database.insert(hrReports).values({
    reportId: input.reportId,
    reporterId: input.reporterId,
    subjectType: input.subjectType,
    ...hrReportSubjectColumns(input),
    category: input.category,
    state: "open",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
  if (input.subjectType === "profile") {
    return query
      .onConflictDoNothing({
        target: [hrReports.reporterId, hrReports.profileId],
        where: sql`${hrReports.subjectType} = 'profile' and ${hrReports.state} = 'open'`,
      })
      .returning({ reportId: hrReports.reportId });
  }

  return query
    .onConflictDoNothing({
      target: [
        hrReports.reporterId,
        hrReports.officeChannelId,
        hrReports.messageId,
      ],
      where: sql`${hrReports.subjectType} = 'message' and ${hrReports.state} = 'open'`,
    })
    .returning({ reportId: hrReports.reportId });
}

export function buildHRReportOutboxQuery(
  database: Database,
  input: CreateHRReportInput,
) {
  const outboxId = `hr-report-notification:${input.reportId}`;
  return database
    .insert(hrReportNotificationOutbox)
    .select(
      database
        .select({
          outboxId: sql<string>`${outboxId}`.as("outbox_id"),
          reportId: hrReports.reportId,
          publishedAt: sql<Date | null>`null`.as("published_at"),
          createdAt: sql<Date>`${input.createdAt}`.as("created_at"),
        })
        .from(hrReports)
        .where(eq(hrReports.reportId, input.reportId)),
    )
    .onConflictDoNothing({ target: hrReportNotificationOutbox.outboxId });
}

export function buildHRReportDismissQuery(
  database: Database,
  input: DismissHRReportInput,
) {
  return database
    .update(hrReports)
    .set({
      state: "dismissed",
      dismissedBy: input.operatorId,
      dismissedAt: input.actedAt,
      updatedAt: input.actedAt,
    })
    .where(
      and(
        eq(hrReports.reportId, input.reportId),
        eq(hrReports.state, "open"),
        isNull(hrReports.dismissedBy),
        isNull(hrReports.dismissedAt),
      ),
    )
    .returning({ reportId: hrReports.reportId });
}

export function buildOperatorActionInsertQuery(
  database: Database,
  input: DismissHRReportInput,
) {
  return database
    .insert(operatorActions)
    .select(
      database
        .select({
          actionId: sql<string>`${input.actionId}`.as("action_id"),
          operatorId: hrReports.dismissedBy,
          targetType: sql<string>`'hr_report'`.as("target_type"),
          targetId: hrReports.reportId,
          action: sql<string>`'dismissed'`.as("action"),
          privateNote: sql<string | null>`${input.privateNote}`.as(
            "private_note",
          ),
          actedAt: hrReports.dismissedAt,
          createdAt: sql<Date>`${input.actedAt}`.as("created_at"),
        })
        .from(hrReports)
        .where(
          and(
            eq(hrReports.reportId, input.reportId),
            eq(hrReports.state, "dismissed"),
            eq(hrReports.dismissedBy, input.operatorId),
            eq(hrReports.dismissedAt, input.actedAt),
          ),
        ),
    )
    .onConflictDoNothing({
      target: [
        operatorActions.targetType,
        operatorActions.targetId,
        operatorActions.action,
      ],
    });
}

export function buildMessageRemovalInsertQuery(
  database: Database,
  input: CreateMessageRemovalInput,
) {
  return database
    .insert(messageRemovals)
    .values({
      removalId: input.removalId,
      officeDay: input.officeDay,
      officeChannelId: input.officeChannelId,
      messageId: input.messageId,
      removedBy: input.operatorId,
      removedAt: input.removedAt,
      createdAt: input.removedAt,
    })
    .onConflictDoNothing({
      target: [messageRemovals.officeChannelId, messageRemovals.messageId],
    })
    .returning({ removalId: messageRemovals.removalId });
}

export function buildMessageRemovalReportResolutionQuery(
  database: Database,
  input: CreateMessageRemovalInput,
) {
  return database
    .update(hrReports)
    .set({
      state: "removed",
      removedBy: sql`(select ${messageRemovals.removedBy} from ${messageRemovals} where ${messageRemovals.removalId} = ${input.removalId})`,
      removedAt: sql`(select ${messageRemovals.removedAt} from ${messageRemovals} where ${messageRemovals.removalId} = ${input.removalId})`,
      updatedAt: input.removedAt,
    })
    .where(
      and(
        eq(hrReports.subjectType, "message"),
        eq(hrReports.state, "open"),
        sql`exists (select 1 from ${messageRemovals} where ${messageRemovals.removalId} = ${input.removalId} and ${messageRemovals.officeChannelId} = ${hrReports.officeChannelId} and ${messageRemovals.messageId} = ${hrReports.messageId})`,
      ),
    );
}

export function buildMessageRemovalAuditQuery(
  database: Database,
  input: CreateMessageRemovalInput,
) {
  return database
    .insert(operatorActions)
    .select(
      database
        .select({
          actionId: sql<string>`${input.actionId}`.as("action_id"),
          operatorId: messageRemovals.removedBy,
          targetType: sql<string>`'message_removal'`.as("target_type"),
          targetId: messageRemovals.removalId,
          action: sql<string>`'removed'`.as("action"),
          privateNote: sql<string>`${input.privateReason}`.as("private_note"),
          actedAt: messageRemovals.removedAt,
          createdAt: sql<Date>`${input.removedAt}`.as("created_at"),
        })
        .from(messageRemovals)
        .where(eq(messageRemovals.removalId, input.removalId)),
    )
    .onConflictDoNothing({
      target: [
        operatorActions.targetType,
        operatorActions.targetId,
        operatorActions.action,
      ],
    });
}

export function buildMessageRemovalOutboxQuery(
  database: Database,
  input: CreateMessageRemovalInput,
) {
  return database
    .insert(messageRemovalInvalidationOutbox)
    .select(
      database
        .select({
          outboxId: sql<string>`${`message-removal:${input.removalId}`}`.as(
            "outbox_id",
          ),
          removalId: messageRemovals.removalId,
          publishedAt: sql<Date | null>`null`.as("published_at"),
          createdAt: sql<Date>`${input.removedAt}`.as("created_at"),
        })
        .from(messageRemovals)
        .where(eq(messageRemovals.removalId, input.removalId)),
    )
    .onConflictDoNothing({
      target: messageRemovalInvalidationOutbox.outboxId,
    });
}

async function selectHRReportReviewRows(
  database: Database,
  limit: number,
  reportId?: string,
) {
  return database
    .select({
      reportId: hrReports.reportId,
      reporterId: hrReports.reporterId,
      subjectType: hrReports.subjectType,
      officeDay: hrReports.officeDay,
      officeChannelId: hrReports.officeChannelId,
      messageId: hrReports.messageId,
      profileId: hrReports.profileId,
      category: hrReports.category,
      state: hrReports.state,
      createdAt: hrReports.createdAt,
      updatedAt: hrReports.updatedAt,
      actionId: operatorActions.actionId,
      operatorId: operatorActions.operatorId,
      action: operatorActions.action,
      privateNote: operatorActions.privateNote,
      actedAt: operatorActions.actedAt,
      actionCreatedAt: operatorActions.createdAt,
    })
    .from(hrReports)
    .leftJoin(
      operatorActions,
      and(
        eq(operatorActions.targetType, "hr_report"),
        eq(operatorActions.targetId, hrReports.reportId),
        eq(operatorActions.action, "dismissed"),
      ),
    )
    .where(reportId ? eq(hrReports.reportId, reportId) : undefined)
    .orderBy(
      sql`case when ${hrReports.state} = 'open' then 0 else 1 end`,
      desc(hrReports.createdAt),
    )
    .limit(limit);
}

type HRReportReviewRow = Awaited<
  ReturnType<typeof selectHRReportReviewRows>
>[number];

function isHRReportReviewState(
  state: string,
): state is HRReportReviewRecord["state"] {
  return state === "open" || state === "dismissed" || state === "removed";
}

function toHRReportResolution(
  row: HRReportReviewRow,
): HRReportResolution | null {
  if (
    !row.actionId ||
    !row.operatorId ||
    row.action !== "dismissed" ||
    !row.actedAt ||
    !row.actionCreatedAt
  ) {
    return null;
  }

  return {
    actionId: row.actionId,
    operatorId: row.operatorId,
    action: row.action,
    privateNote: row.privateNote,
    actedAt: row.actedAt,
    createdAt: row.actionCreatedAt,
  };
}

function toHRReportReviewRecord(
  row: HRReportReviewRow,
): HRReportReviewRecord | null {
  if (
    !isHRReportReviewState(row.state) ||
    (row.action !== null && row.action !== "dismissed")
  ) {
    return null;
  }

  const shared = {
    reportId: row.reportId,
    reporterId: row.reporterId,
    state: row.state,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolution: toHRReportResolution(row),
  };

  if (
    row.subjectType === "message" &&
    row.officeDay &&
    row.officeChannelId &&
    row.messageId
  ) {
    return {
      ...shared,
      subjectType: "message",
      officeDay: row.officeDay,
      officeChannelId: row.officeChannelId,
      messageId: row.messageId,
      category: row.category as MessageHRReportCategory,
    };
  }

  if (row.subjectType === "profile" && row.profileId) {
    return {
      ...shared,
      subjectType: "profile",
      profileId: row.profileId,
      category: row.category as ProfileHRReportCategory,
    };
  }

  return null;
}
export function createNeonRepository(database: Database): NeonAdapter {
  async function listHRReportRows(
    limit: number,
    reportId?: string,
  ): Promise<HRReportReviewRecord[]> {
    const rows = await selectHRReportReviewRows(database, limit, reportId);
    const reports: HRReportReviewRecord[] = [];
    for (const row of rows) {
      const report = toHRReportReviewRecord(row);
      if (report) {
        reports.push(report);
      }
    }
    return reports;
  }

  async function findOnboarding(
    clerkUserId: string,
  ): Promise<OnboardingSnapshot | null> {
    const [row] = await database
      .select({
        clerkUserId: clerkProfiles.clerkUserId,
        firstName: clerkProfiles.firstName,
        lastName: clerkProfiles.lastName,
        displayName: clerkProfiles.displayName,
        imageUrl: clerkProfiles.imageUrl,
        jobTitle: newHireOnboarding.jobTitle,
        profileConfirmedAt: newHireOnboarding.profileConfirmedAt,
        conductAcceptedAt: newHireOnboarding.conductAcceptedAt,
        completedAt: newHireOnboarding.completedAt,
      })
      .from(newHireOnboarding)
      .innerJoin(
        clerkProfiles,
        eq(newHireOnboarding.clerkUserId, clerkProfiles.clerkUserId),
      )
      .where(eq(newHireOnboarding.clerkUserId, clerkUserId))
      .limit(1);

    return row ? toSnapshot(row) : null;
  }

  async function requireOnboarding(
    clerkUserId: string,
  ): Promise<OnboardingSnapshot> {
    const onboarding = await findOnboarding(clerkUserId);
    if (!onboarding) {
      throw new OnboardingError(
        "onboarding_not_found",
        "Start New Employee Setup before continuing.",
      );
    }
    return onboarding;
  }

  async function projectProfile(profile: NewHireProfile) {
    const [changed] = await database.batch([
      buildProfileProjectionQuery(database, profile),
      buildProfileOutboxQuery(database, profile, new Date()),
    ]);

    return changed.length > 0 ? "applied" : "unchanged";
  }

  async function getProfiles(
    clerkUserIds: readonly string[],
  ): Promise<ProfileAttribution[]> {
    if (clerkUserIds.length === 0) {
      return [];
    }

    const rows = await database
      .select({
        clerkUserId: clerkProfiles.clerkUserId,
        displayName: clerkProfiles.displayName,
        imageUrl: clerkProfiles.imageUrl,
      })
      .from(clerkProfiles)
      .where(inArray(clerkProfiles.clerkUserId, [...clerkUserIds]));
    const rowsById = new Map(rows.map((row) => [row.clerkUserId, row]));

    return clerkUserIds.map((clerkUserId) => {
      return toProfileAttribution(clerkUserId, rowsById.get(clerkUserId));
    });
  }

  return {
    async seedOfficeDay(currentOfficeDay, seededAt) {
      const planned = planOfficeDay(currentOfficeDay);
      await database.batch(
        buildOfficeDayQueries(database, currentOfficeDay, seededAt),
      );
      return planned.length;
    },

    async pendingSystemEvents(currentOfficeDay, dueAt, limit) {
      const rows = await database
        .select({
          eventKey: scriptedSystemEventOutbox.eventKey,
          officeDay: scriptedSystemEventOutbox.officeDay,
          scriptId: scriptedSystemEventOutbox.scriptId,
          channelId: scriptedSystemEventOutbox.channelId,
          characterId: scriptedSystemEventOutbox.characterId,
          dueAt: scriptedSystemEventOutbox.dueAt,
          attemptCount: scriptedSystemEventOutbox.attemptCount,
          lastAttemptAt: scriptedSystemEventOutbox.lastAttemptAt,
        })
        .from(scriptedSystemEventOutbox)
        .where(
          and(
            eq(scriptedSystemEventOutbox.officeDay, currentOfficeDay),
            isNull(scriptedSystemEventOutbox.publishedAt),
            lte(scriptedSystemEventOutbox.dueAt, dueAt),
          ),
        )
        .orderBy(asc(scriptedSystemEventOutbox.dueAt))
        .limit(limit);
      const plannedByKey = new Map(
        planOfficeDay(currentOfficeDay).map((entry) => [entry.eventKey, entry]),
      );
      const pendingEntries: ScriptedSystemEventOutboxEntry[] = [];
      for (const row of rows) {
        const planned = plannedByKey.get(row.eventKey);
        if (!matchesPlannedSystemEvent(row, planned)) {
          continue;
        }
        pendingEntries.push({
          ...planned,
          attemptCount: row.attemptCount,
          lastAttemptAt: row.lastAttemptAt,
        });
      }
      return pendingEntries;
    },

    async markSystemEventAttempt(eventKey, attemptedAt) {
      await database
        .update(scriptedSystemEventOutbox)
        .set({
          attemptCount: sql`${scriptedSystemEventOutbox.attemptCount} + 1`,
          lastAttemptAt: attemptedAt,
        })
        .where(
          and(
            eq(scriptedSystemEventOutbox.eventKey, eventKey),
            isNull(scriptedSystemEventOutbox.publishedAt),
          ),
        );
    },

    async markSystemEventPublished(eventKey, publishedAt) {
      await database
        .update(scriptedSystemEventOutbox)
        .set({ publishedAt })
        .where(
          and(
            eq(scriptedSystemEventOutbox.eventKey, eventKey),
            isNull(scriptedSystemEventOutbox.publishedAt),
            isNotNull(scriptedSystemEventOutbox.lastAttemptAt),
          ),
        );
    },

    projectProfile,
    getProfiles,
    async pendingProfileInvalidations(limit) {
      const rows = await database
        .select({
          eventKey: profileInvalidationOutbox.eventKey,
          profileId: profileInvalidationOutbox.profileId,
          occurredAt: profileInvalidationOutbox.occurredAt,
        })
        .from(profileInvalidationOutbox)
        .where(isNull(profileInvalidationOutbox.publishedAt))
        .orderBy(asc(profileInvalidationOutbox.createdAt))
        .limit(limit);
      return rows.map(
        (row): ProfileInvalidationOutboxEntry => ({
          outboxId: row.eventKey,
          event: {
            version: OFFICE_EVENT_VERSION,
            type: "profile.invalidated",
            eventKey: row.eventKey,
            occurredAt: row.occurredAt.toISOString(),
            profileId: row.profileId,
          },
        }),
      );
    },
    async markProfileInvalidationPublished(outboxId, publishedAt) {
      await database
        .update(profileInvalidationOutbox)
        .set({ publishedAt })
        .where(
          and(
            eq(profileInvalidationOutbox.eventKey, outboxId),
            isNull(profileInvalidationOutbox.publishedAt),
          ),
        );
    },
    async createHRReport(input) {
      const [createdRows] = await database.batch([
        buildHRReportInsertQuery(database, input),
        buildHRReportOutboxQuery(database, input),
      ]);
      const created = createdRows[0];
      if (created) {
        return { reportId: created.reportId, status: "created" };
      }
      const identityCondition =
        input.subjectType === "message"
          ? and(
              eq(hrReports.officeChannelId, input.officeChannelId),
              eq(hrReports.messageId, input.messageId),
            )
          : eq(hrReports.profileId, input.profileId);
      const [existing] = await database
        .select({ reportId: hrReports.reportId })
        .from(hrReports)
        .where(
          and(
            eq(hrReports.reporterId, input.reporterId),
            eq(hrReports.subjectType, input.subjectType),
            identityCondition,
            eq(hrReports.state, "open"),
          ),
        )
        .limit(1);
      if (!existing) {
        throw new Error("HR Report uniqueness could not be resolved.");
      }
      return { reportId: existing.reportId, status: "already-reported" };
    },
    listHRReports: listHRReportRows,
    async dismissHRReport(input) {
      const [dismissedRows] = await database.batch([
        buildHRReportDismissQuery(database, input),
        buildOperatorActionInsertQuery(database, input),
      ]);
      const [report] = await listHRReportRows(1, input.reportId);
      if (!report) return null;
      return {
        status: dismissedRows.length > 0 ? "dismissed" : "already-dismissed",
        report,
      };
    },
    async createMessageRemoval(input) {
      const [createdRows] = await database.batch([
        buildMessageRemovalInsertQuery(database, input),
        buildMessageRemovalReportResolutionQuery(database, input),
        buildMessageRemovalAuditQuery(database, input),
        buildMessageRemovalOutboxQuery(database, input),
      ]);
      const [row] = await database
        .select({
          removalId: messageRemovals.removalId,
          officeDay: messageRemovals.officeDay,
          officeChannelId: messageRemovals.officeChannelId,
          messageId: messageRemovals.messageId,
          removedAt: messageRemovals.removedAt,
        })
        .from(messageRemovals)
        .where(
          and(
            eq(messageRemovals.officeChannelId, input.officeChannelId),
            eq(messageRemovals.messageId, input.messageId),
          ),
        )
        .limit(1);
      if (!row) {
        throw new Error("Removed Message uniqueness could not be resolved.");
      }
      return {
        status: createdRows.length > 0 ? "removed" : "already-removed",
        removal: row,
      };
    },
    async listMessageRemovals(officeChannelId) {
      return database
        .select({
          removalId: messageRemovals.removalId,
          officeDay: messageRemovals.officeDay,
          officeChannelId: messageRemovals.officeChannelId,
          messageId: messageRemovals.messageId,
          removedAt: messageRemovals.removedAt,
        })
        .from(messageRemovals)
        .where(eq(messageRemovals.officeChannelId, officeChannelId))
        .orderBy(asc(messageRemovals.removedAt));
    },
    async pendingMessageRemovalInvalidations(limit) {
      const rows = await database
        .select({
          outboxId: messageRemovalInvalidationOutbox.outboxId,
          removalId: messageRemovals.removalId,
          messageId: messageRemovals.messageId,
          occurredAt: messageRemovals.removedAt,
        })
        .from(messageRemovalInvalidationOutbox)
        .innerJoin(
          messageRemovals,
          eq(
            messageRemovalInvalidationOutbox.removalId,
            messageRemovals.removalId,
          ),
        )
        .where(isNull(messageRemovalInvalidationOutbox.publishedAt))
        .orderBy(asc(messageRemovalInvalidationOutbox.createdAt))
        .limit(limit);
      return rows as PendingMessageRemovalInvalidation[];
    },
    async markMessageRemovalInvalidationPublished(outboxId, publishedAt) {
      await database
        .update(messageRemovalInvalidationOutbox)
        .set({ publishedAt })
        .where(
          and(
            eq(messageRemovalInvalidationOutbox.outboxId, outboxId),
            isNull(messageRemovalInvalidationOutbox.publishedAt),
          ),
        );
    },
    async pendingHRReportNotifications(limit) {
      const rows = await database
        .select({
          outboxId: hrReportNotificationOutbox.outboxId,
          subjectType: hrReports.subjectType,
          officeDay: hrReports.officeDay,
          officeChannelId: hrReports.officeChannelId,
          messageId: hrReports.messageId,
          profileId: hrReports.profileId,
        })
        .from(hrReportNotificationOutbox)
        .innerJoin(
          hrReports,
          eq(hrReportNotificationOutbox.reportId, hrReports.reportId),
        )
        .where(
          and(
            isNull(hrReportNotificationOutbox.publishedAt),
            eq(hrReports.state, "open"),
          ),
        )
        .orderBy(asc(hrReportNotificationOutbox.createdAt))
        .limit(limit);
      const pending: PendingHRReportNotification[] = [];
      for (const row of rows) {
        if (row.subjectType === "profile" && row.profileId) {
          pending.push({
            outboxId: row.outboxId,
            subjectType: "profile",
            profileId: row.profileId,
          });
        } else if (
          row.subjectType === "message" &&
          row.officeDay &&
          row.officeChannelId &&
          row.messageId
        ) {
          pending.push({
            outboxId: row.outboxId,
            subjectType: "message",
            officeDay: row.officeDay,
            officeChannelId: row.officeChannelId,
            messageId: row.messageId,
          });
        }
      }
      return pending;
    },
    async markHRReportNotificationPublished(outboxId, publishedAt) {
      await database
        .update(hrReportNotificationOutbox)
        .set({ publishedAt })
        .where(
          and(
            eq(hrReportNotificationOutbox.outboxId, outboxId),
            isNull(hrReportNotificationOutbox.publishedAt),
          ),
        );
    },
    async enterNewHire(profile) {
      await projectProfile(profile);
      await database
        .insert(newHireOnboarding)
        .values({
          clerkUserId: profile.clerkUserId,
          jobTitle: assignJobTitle(profile.clerkUserId),
        })
        .onConflictDoNothing({ target: newHireOnboarding.clerkUserId });
      return requireOnboarding(profile.clerkUserId);
    },

    async confirmProfile(clerkUserId) {
      await database
        .update(newHireOnboarding)
        .set({
          profileConfirmedAt: sql`coalesce(${newHireOnboarding.profileConfirmedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(newHireOnboarding.clerkUserId, clerkUserId));
      return requireOnboarding(clerkUserId);
    },

    async acceptConduct(clerkUserId) {
      await database
        .update(newHireOnboarding)
        .set({
          conductAcceptedAt: sql`coalesce(${newHireOnboarding.conductAcceptedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(newHireOnboarding.clerkUserId, clerkUserId),
            isNotNull(newHireOnboarding.profileConfirmedAt),
          ),
        );
      const onboarding = await requireOnboarding(clerkUserId);
      if (!onboarding.conductAcceptedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Confirm your New Hire Profile before accepting the conduct policy.",
        );
      }
      return onboarding;
    },

    async clockIn(clerkUserId) {
      await database
        .update(newHireOnboarding)
        .set({
          completedAt: sql`coalesce(${newHireOnboarding.completedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(newHireOnboarding.clerkUserId, clerkUserId),
            isNotNull(newHireOnboarding.profileConfirmedAt),
            isNotNull(newHireOnboarding.conductAcceptedAt),
          ),
        );
      const onboarding = await requireOnboarding(clerkUserId);
      if (!onboarding.completedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Complete your profile and accept the code of conduct before Clock In.",
        );
      }
      return onboarding;
    },

    getNewHire: findOnboarding,
  };
}
