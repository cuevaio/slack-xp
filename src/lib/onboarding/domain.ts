import { createHash } from "node:crypto";
import type {
  OnboardingSnapshot,
  OnboardingStep,
} from "@/lib/onboarding/types";

const JOB_TITLES = [
  "Senior Synergy Installation Specialist",
  "Vice President of Reply-All Prevention",
  "Principal Fax Machine Reliability Engineer",
  "Director of Strategic Screen Savers",
  "Regional Mouse Pad Procurement Liaison",
  "Executive Spreadsheet Color Coordinator",
  "Chief Meeting Rescheduling Officer",
  "Associate Beverage Temperature Auditor",
  "Lead Internet Download Supervisor",
  "Corporate Password Hint Anthropologist",
  "Assistant to the Assistant Webmaster",
  "Distinguished Printer Queue Evangelist",
] as const;

const ALLOWED_PROFILE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_PROFILE_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

export type ProfileInput = {
  firstName: string;
  lastName: string;
  image: File | null;
};

export type ProfileInputField = "firstName" | "lastName" | "image";

export class OnboardingError extends Error {
  constructor(
    public readonly code:
      | "invalid_profile"
      | "onboarding_incomplete"
      | "onboarding_not_found",
    message: string,
    public readonly field?: ProfileInputField,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

export function assignJobTitle(clerkUserId: string): string {
  const digest = createHash("sha256")
    .update(`portal-messenger-job-title-v1:${clerkUserId}`)
    .digest();
  return JOB_TITLES[digest.readUInt32BE(0) % JOB_TITLES.length];
}

export function formatDisplayName(firstName: string, lastName: string): string {
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function getOnboardingStep(
  onboarding: Pick<
    OnboardingSnapshot,
    "profileConfirmedAt" | "conductAcceptedAt" | "completedAt"
  >,
): OnboardingStep {
  if (onboarding.completedAt) {
    return "complete";
  }
  if (!onboarding.profileConfirmedAt) {
    return "profile";
  }
  if (!onboarding.conductAcceptedAt) {
    return "conduct";
  }
  return "clock-in";
}

export function validateProfileInput(input: ProfileInput): {
  firstName: string;
  lastName: string;
} {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const displayName = formatDisplayName(firstName, lastName);

  if (!firstName) {
    throw new OnboardingError(
      "invalid_profile",
      "Please enter a first name before continuing.",
      "firstName",
    );
  }
  if (displayName.length > 80) {
    throw new OnboardingError(
      "invalid_profile",
      "Your public name must be 80 characters or fewer.",
      "firstName",
    );
  }

  if (/\p{Cc}|\p{Cf}/u.test(displayName)) {
    throw new OnboardingError(
      "invalid_profile",
      "Public names cannot contain control or invisible formatting characters.",
      "firstName",
    );
  }

  if (input.image) {
    if (!ALLOWED_PROFILE_IMAGE_TYPES.has(input.image.type)) {
      throw new OnboardingError(
        "invalid_profile",
        "Profile pictures must be PNG, JPEG, or WebP files.",
        "image",
      );
    }
    if (input.image.size > MAX_PROFILE_IMAGE_SIZE_BYTES) {
      throw new OnboardingError(
        "invalid_profile",
        "Profile pictures must be 2 MB or smaller.",
        "image",
      );
    }
  }

  return { firstName, lastName };
}
