export const ONBOARDING_STEPS = [
  "profile",
  "conduct",
  "clock-in",
  "complete",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type NewHireProfile = {
  clerkUserId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  imageUrl: string | null;
  sourceVersion: number;
};

export type OnboardingSnapshot = {
  clerkUserId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  imageUrl: string | null;
  jobTitle: string;
  profileConfirmedAt: string | null;
  conductAcceptedAt: string | null;
  completedAt: string | null;
  step: OnboardingStep;
};

export type OnboardingRepository = {
  enterNewHire(profile: NewHireProfile): Promise<OnboardingSnapshot>;
  confirmProfile(clerkUserId: string): Promise<OnboardingSnapshot>;
  acceptConduct(clerkUserId: string): Promise<OnboardingSnapshot>;
  clockIn(clerkUserId: string): Promise<OnboardingSnapshot>;
  getNewHire(clerkUserId: string): Promise<OnboardingSnapshot | null>;
};
