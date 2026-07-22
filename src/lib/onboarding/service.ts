import { OnboardingError } from "@/lib/onboarding/domain";
import type {
  NewHireProfile,
  OnboardingRepository,
  OnboardingSnapshot,
} from "@/lib/onboarding/types";

export async function confirmNewHireProfile(
  repository: OnboardingRepository,
  updateClerk: () => Promise<NewHireProfile>,
): Promise<OnboardingSnapshot> {
  // Do not mark the Neon step complete unless Clerk accepted the authoritative
  // profile update. Retrying after the opposite partial failure is safe because
  // authenticated entry repairs the projection from Clerk.
  const authoritativeProfile = await updateClerk();
  return repository.confirmProfile(authoritativeProfile);
}

export async function acceptNewHireConduct(
  repository: OnboardingRepository,
  clerkUserId: string,
  accepted: boolean,
): Promise<OnboardingSnapshot> {
  if (!accepted) {
    throw new OnboardingError(
      "onboarding_incomplete",
      "Accept the code of conduct before continuing.",
    );
  }
  return repository.acceptConduct(clerkUserId);
}
