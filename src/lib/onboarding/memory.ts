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

type StoredNewHire = NewHireProfile & {
  jobTitle: string;
  profileConfirmedAt: string | null;
  conductAcceptedAt: string | null;
  completedAt: string | null;
};

function toSnapshot(record: StoredNewHire): OnboardingSnapshot {
  return {
    clerkUserId: record.clerkUserId,
    firstName: record.firstName,
    lastName: record.lastName,
    displayName: record.displayName,
    imageUrl: record.imageUrl,
    jobTitle: record.jobTitle,
    profileConfirmedAt: record.profileConfirmedAt,
    conductAcceptedAt: record.conductAcceptedAt,
    completedAt: record.completedAt,
    step: getOnboardingStep(record),
  };
}

export type InMemoryOnboardingRepository = OnboardingRepository & {
  recordCount(): number;
  reset(): void;
};

export function createInMemoryOnboardingRepository(
  now: () => Date = () => new Date(),
): InMemoryOnboardingRepository {
  const records = new Map<string, StoredNewHire>();

  function requireRecord(clerkUserId: string): StoredNewHire {
    const record = records.get(clerkUserId);
    if (!record) {
      throw new OnboardingError(
        "onboarding_not_found",
        "Start New Employee Setup before continuing.",
      );
    }
    return record;
  }

  return {
    async enterNewHire(profile) {
      let record = records.get(profile.clerkUserId);
      if (!record) {
        record = {
          ...profile,
          jobTitle: assignJobTitle(profile.clerkUserId),
          profileConfirmedAt: null,
          conductAcceptedAt: null,
          completedAt: null,
        };
        records.set(profile.clerkUserId, record);
      } else if (profile.sourceVersion > record.sourceVersion) {
        Object.assign(record, profile);
      }
      return toSnapshot(record);
    },

    async confirmProfile(profile) {
      const record = requireRecord(profile.clerkUserId);
      Object.assign(record, profile, {
        profileConfirmedAt: record.profileConfirmedAt ?? now().toISOString(),
      });
      return toSnapshot(record);
    },

    async acceptConduct(clerkUserId) {
      const record = requireRecord(clerkUserId);
      if (!record.profileConfirmedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Confirm your New Hire Profile before accepting the conduct policy.",
        );
      }
      record.conductAcceptedAt ??= now().toISOString();
      return toSnapshot(record);
    },

    async clockIn(clerkUserId) {
      const record = requireRecord(clerkUserId);
      if (!record.profileConfirmedAt || !record.conductAcceptedAt) {
        throw new OnboardingError(
          "onboarding_incomplete",
          "Complete your profile and accept the code of conduct before Clock In.",
        );
      }
      record.completedAt ??= now().toISOString();
      return toSnapshot(record);
    },

    async getNewHire(clerkUserId) {
      const record = records.get(clerkUserId);
      return record ? toSnapshot(record) : null;
    },

    recordCount() {
      return records.size;
    },

    reset() {
      records.clear();
    },
  };
}
