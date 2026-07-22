import type { NewHireProfile } from "@/lib/onboarding/types";

export type ProfileAttribution = {
  clerkUserId: string;
  displayName: string;
  imageUrl: string | null;
  status: "current" | "unavailable";
};

export type ProfileProjectionResult = "applied" | "unchanged";

export type ProfileRepository = {
  projectProfile(profile: NewHireProfile): Promise<ProfileProjectionResult>;
  getProfiles(clerkUserIds: readonly string[]): Promise<ProfileAttribution[]>;
};
