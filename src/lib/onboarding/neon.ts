import {
  and,
  asc,
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
  newHireOnboarding,
  officeDays,
  profileInvalidationOutbox,
  scriptedSystemEventOutbox,
} from "@/lib/db/schema";
import { planOfficeDay } from "@/lib/office-days/contract";
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

export function createNeonRepository(database: Database): NeonAdapter {
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
      return rows.flatMap((row): ScriptedSystemEventOutboxEntry[] => {
        const planned = plannedByKey.get(row.eventKey);
        if (
          !planned ||
          planned.scriptId !== row.scriptId ||
          planned.channelId !== row.channelId ||
          planned.characterId !== row.characterId ||
          planned.dueAt.getTime() !== row.dueAt.getTime()
        ) {
          return [];
        }
        return [
          {
            ...planned,
            attemptCount: row.attemptCount,
            lastAttemptAt: row.lastAttemptAt,
          },
        ];
      });
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
