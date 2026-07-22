import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { NeonAdapter } from "@/lib/adapters/types";
import type { Database } from "@/lib/db/client";
import { clerkProfiles, newHireOnboarding } from "@/lib/db/schema";
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
import type { ProfileAttribution } from "@/lib/profiles/types";

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
    const changed = await buildProfileProjectionQuery(database, profile);

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
    projectProfile,
    getProfiles,
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

    async confirmProfile(profile) {
      await projectProfile(profile);
      await database
        .update(newHireOnboarding)
        .set({
          profileConfirmedAt: sql`coalesce(${newHireOnboarding.profileConfirmedAt}, now())`,
          updatedAt: new Date(),
        })
        .where(eq(newHireOnboarding.clerkUserId, profile.clerkUserId));
      return requireOnboarding(profile.clerkUserId);
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
