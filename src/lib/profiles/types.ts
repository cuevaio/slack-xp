import type { OfficeInvalidationEvent } from "@/lib/office-events/contract";
import type { NewHireProfile } from "@/lib/onboarding/types";

export type ProfileAttribution = {
  clerkUserId: string;
  displayName: string;
  imageUrl: string | null;
  status: "current" | "unavailable";
};

export type ProfileProjectionResult = "applied" | "unchanged";

export type ProfileInvalidationEvent = Extract<
  OfficeInvalidationEvent,
  { type: "profile.invalidated" }
>;

export type ProfileInvalidationOutboxEntry = {
  outboxId: string;
  event: ProfileInvalidationEvent;
};

export type ProfileInvalidationPublisher = {
  publishProfileInvalidation(event: ProfileInvalidationEvent): Promise<void>;
};

export type ProfileRepository = {
  projectProfile(profile: NewHireProfile): Promise<ProfileProjectionResult>;
  getProfiles(clerkUserIds: readonly string[]): Promise<ProfileAttribution[]>;
  pendingProfileInvalidations(
    limit: number,
  ): Promise<ProfileInvalidationOutboxEntry[]>;
  markProfileInvalidationPublished(
    outboxId: string,
    publishedAt: Date,
  ): Promise<void>;
};
