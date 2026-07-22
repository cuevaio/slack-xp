import type {
  NewHireProfile,
  OnboardingRepository,
  OnboardingSnapshot,
} from "@/lib/onboarding/types";
import type {
  ProfileAttribution,
  ProfileRepository,
} from "@/lib/profiles/types";

export type ProfileConvergence = "awaiting_projection" | "projected";

export type EmployeeRecordUpdate = {
  record: NewHireProfile;
  convergence: ProfileConvergence;
  onboarding: OnboardingSnapshot | null;
};

export class ProfileUpdateError extends Error {
  constructor(
    public readonly code:
      | "profile_partially_updated"
      | "profile_confirmation_unavailable"
      | "profile_projection_unavailable"
      | "profile_rejected"
      | "profile_update_timed_out"
      | "profile_update_unavailable",
    message: string,
  ) {
    super(message);
    this.name = "ProfileUpdateError";
  }
}

function hasConverged(
  profile: NewHireProfile,
  projection: ProfileAttribution | undefined,
): boolean {
  return (
    projection?.status === "current" &&
    projection.displayName === profile.displayName &&
    projection.imageUrl === profile.imageUrl
  );
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(
        new ProfileUpdateError(
          "profile_update_timed_out",
          "Clerk did not confirm the update in time. Your entries are ready to retry.",
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function readConvergence(
  repository: ProfileRepository,
  profile: NewHireProfile,
): Promise<ProfileConvergence> {
  const [projection] = await repository.getProfiles([profile.clerkUserId]);
  return hasConverged(profile, projection)
    ? "projected"
    : "awaiting_projection";
}

export async function updateEmployeeRecord({
  repository,
  updateAuthority,
  onAuthorityConfirmed,
  timeoutMs = 10_000,
}: {
  repository: ProfileRepository;
  updateAuthority: () => Promise<NewHireProfile>;
  onAuthorityConfirmed?: (clerkUserId: string) => Promise<OnboardingSnapshot>;
  timeoutMs?: number;
}): Promise<EmployeeRecordUpdate> {
  let record: NewHireProfile;
  try {
    record = await withDeadline(updateAuthority(), timeoutMs);
  } catch (error) {
    if (error instanceof ProfileUpdateError) throw error;
    throw new ProfileUpdateError(
      "profile_update_unavailable",
      "Employee Record changes are temporarily unavailable. Your entries are ready to retry.",
    );
  }

  let onboarding: OnboardingSnapshot | null = null;
  if (onAuthorityConfirmed) {
    try {
      onboarding = await onAuthorityConfirmed(record.clerkUserId);
    } catch {
      throw new ProfileUpdateError(
        "profile_confirmation_unavailable",
        "Clerk saved the changes, but New Employee Setup could not confirm them yet. Your entries are ready to retry.",
      );
    }
  }

  try {
    return {
      record,
      convergence: await readConvergence(repository, record),
      onboarding,
    };
  } catch {
    throw new ProfileUpdateError(
      "profile_projection_unavailable",
      "Clerk saved the changes, but the Shared Public Office has not confirmed them yet. Check again shortly.",
    );
  }
}

export async function repairEmployeeRecordProjection(
  repository: ProfileRepository & Pick<OnboardingRepository, "getNewHire">,
  authoritativeProfile: NewHireProfile,
): Promise<EmployeeRecordUpdate> {
  await repository.projectProfile(authoritativeProfile);
  return {
    record: authoritativeProfile,
    convergence: await readConvergence(repository, authoritativeProfile),
    onboarding: await repository.getNewHire(authoritativeProfile.clerkUserId),
  };
}

export async function readEmployeeRecordProjection(
  repository: ProfileRepository & Pick<OnboardingRepository, "getNewHire">,
  authoritativeProfile: NewHireProfile,
): Promise<EmployeeRecordUpdate> {
  return {
    record: authoritativeProfile,
    convergence: await readConvergence(repository, authoritativeProfile),
    onboarding: await repository.getNewHire(authoritativeProfile.clerkUserId),
  };
}
