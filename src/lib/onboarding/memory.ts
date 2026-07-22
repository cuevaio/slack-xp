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
import { UNAVAILABLE_PROFILE_NAME } from "@/lib/profiles/domain";
import type {
  ProfileAttribution,
  ProfileProjectionResult,
  ProfileRepository,
} from "@/lib/profiles/types";

type StoredOnboarding = {
  jobTitle: string;
  profileConfirmedAt: string | null;
  conductAcceptedAt: string | null;
  completedAt: string | null;
};

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

export type InMemoryNeonRepository = OnboardingRepository &
  ProfileRepository & {
    recordCount(): number;
    projectionWriteCount(): number;
    profileBatchReadCount(): number;
    reset(): void;
  };

export function createInMemoryNeonRepository(
  now: () => Date = () => new Date(),
): InMemoryNeonRepository {
  const profiles = new Map<string, NewHireProfile>();
  const onboardings = new Map<string, StoredOnboarding>();
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

  function projectProfile(profile: NewHireProfile): ProfileProjectionResult {
    const current = profiles.get(profile.clerkUserId);
    if (
      current &&
      (current.sourceVersion > profile.sourceVersion ||
        (current.sourceVersion === profile.sourceVersion &&
          current.firstName === profile.firstName &&
          current.lastName === profile.lastName &&
          current.displayName === profile.displayName &&
          current.imageUrl === profile.imageUrl))
    ) {
      return "unchanged";
    }

    profiles.set(profile.clerkUserId, { ...profile });
    projectionWrites += 1;
    return "applied";
  }

  return {
    async projectProfile(profile) {
      return projectProfile(profile);
    },

    async getProfiles(clerkUserIds) {
      profileBatchReads += 1;
      return clerkUserIds.map<ProfileAttribution>((clerkUserId) => {
        const profile = profiles.get(clerkUserId);
        return profile
          ? {
              clerkUserId,
              displayName: profile.displayName,
              imageUrl: profile.imageUrl,
              status: "current",
            }
          : {
              clerkUserId,
              displayName: UNAVAILABLE_PROFILE_NAME,
              imageUrl: null,
              status: "unavailable",
            };
      });
    },

    async enterNewHire(profile) {
      projectProfile(profile);
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

    async confirmProfile(profile) {
      const onboarding = requireOnboarding(profile.clerkUserId);
      projectProfile(profile);
      onboarding.profileConfirmedAt ??= now().toISOString();
      return toSnapshot(requireProfile(profile.clerkUserId), onboarding);
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

    projectionWriteCount() {
      return projectionWrites;
    },

    profileBatchReadCount() {
      return profileBatchReads;
    },

    reset() {
      profiles.clear();
      onboardings.clear();
      projectionWrites = 0;
      profileBatchReads = 0;
    },
  };
}

export const createInMemoryOnboardingRepository = createInMemoryNeonRepository;
