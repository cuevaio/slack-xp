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

export function createNeonOnboardingRepository(
  database: Database,
): OnboardingRepository {
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
