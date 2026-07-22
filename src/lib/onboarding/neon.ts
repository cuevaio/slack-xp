import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { clerkProfiles, newHireOnboarding } from "@/lib/db/schema";
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

type SelectedNewHire = {
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

function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toSnapshot(row: SelectedNewHire): OnboardingSnapshot {
  if (!row.firstName || row.lastName === null || !row.displayName) {
    throw new OnboardingError(
      "onboarding_incomplete",
      "A tombstoned or invalid Clerk profile cannot enter the Office Day.",
    );
  }
  const values = {
    profileConfirmedAt: toIso(row.profileConfirmedAt),
    conductAcceptedAt: toIso(row.conductAcceptedAt),
    completedAt: toIso(row.completedAt),
  };
  return {
    clerkUserId: row.clerkUserId,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    imageUrl: row.imageUrl,
    jobTitle: row.jobTitle,
    ...values,
    step: getOnboardingStep(values),
  };
}

export function createNeonOnboardingRepository(
  database: Database,
): OnboardingRepository {
  async function find(clerkUserId: string): Promise<OnboardingSnapshot | null> {
    const rows = await database
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

    return rows[0] ? toSnapshot(rows[0]) : null;
  }

  async function requireSnapshot(
    clerkUserId: string,
  ): Promise<OnboardingSnapshot> {
    const result = await find(clerkUserId);
    if (!result) {
      throw new OnboardingError(
        "onboarding_not_found",
        "Start New Employee Setup before continuing.",
      );
    }
    return result;
  }

  async function projectProfile(profile: NewHireProfile): Promise<void> {
    await database
      .insert(clerkProfiles)
      .values(profile)
      .onConflictDoNothing({ target: clerkProfiles.clerkUserId });

    // A delayed request must not overwrite a newer Clerk projection.
    await database
      .update(clerkProfiles)
      .set({
        firstName: profile.firstName,
        lastName: profile.lastName,
        displayName: profile.displayName,
        imageUrl: profile.imageUrl,
        sourceVersion: profile.sourceVersion,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(clerkProfiles.clerkUserId, profile.clerkUserId),
          lte(clerkProfiles.sourceVersion, profile.sourceVersion),
        ),
      );
  }

  return {
    async enterNewHire(profile) {
      await projectProfile(profile);
      await database
        .insert(newHireOnboarding)
        .values({
          clerkUserId: profile.clerkUserId,
          jobTitle: assignJobTitle(profile.clerkUserId),
        })
        .onConflictDoNothing({ target: newHireOnboarding.clerkUserId });
      return requireSnapshot(profile.clerkUserId);
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
      return requireSnapshot(profile.clerkUserId);
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
      const result = await requireSnapshot(clerkUserId);
      if (!result.conductAcceptedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Confirm your New Hire Profile before accepting the conduct policy.",
        );
      }
      return result;
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
      const result = await requireSnapshot(clerkUserId);
      if (!result.completedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Complete your profile and accept the code of conduct before Clock In.",
        );
      }
      return result;
    },

    getNewHire: find,
  };
}
