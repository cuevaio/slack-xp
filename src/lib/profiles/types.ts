import type { OfficeInvalidationEvent } from "@/lib/office-events/contract";
import type { NewHireProfile } from "@/lib/onboarding/types";

export type ProfileAttribution = {
  clerkUserId: string;
  displayName: string;
  imageUrl: string | null;
  status: "current" | "former" | "unavailable";
};

export type ProfileProjectionResult = "applied" | "unchanged";

export type DeletedClerkProfile = {
  clerkUserId: string;
  sourceVersion: number;
  deletedAt: Date;
};

export type ProjectProfileOptions = {
  allowTombstoneRestore?: boolean;
};

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
  projectProfile(
    profile: NewHireProfile,
    options?: ProjectProfileOptions,
  ): Promise<ProfileProjectionResult>;
  tombstoneProfile(
    profile: DeletedClerkProfile,
  ): Promise<ProfileProjectionResult>;
  getProfiles(clerkUserIds: readonly string[]): Promise<ProfileAttribution[]>;
  pendingProfileInvalidations(
    limit: number,
  ): Promise<ProfileInvalidationOutboxEntry[]>;
  markProfileInvalidationPublished(
    outboxId: string,
    publishedAt: Date,
  ): Promise<void>;
};
