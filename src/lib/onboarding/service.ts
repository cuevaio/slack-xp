import { OnboardingError } from "@/lib/onboarding/domain";
import type {
  OnboardingRepository,
  OnboardingSnapshot,
} from "@/lib/onboarding/types";

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
