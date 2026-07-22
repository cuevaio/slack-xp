import { createHash } from "node:crypto";
import {
  createOfficeEventKey,
  OFFICE_EVENT_VERSION,
} from "@/lib/office-events/contract";
import type { NewHireProfile } from "@/lib/onboarding/types";
import type {
  ProfileInvalidationEvent,
  ProfileInvalidationOutboxEntry,
} from "@/lib/profiles/types";

function profileChangeSourceId(profile: NewHireProfile): string {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        profile.clerkUserId,
        profile.sourceVersion,
        profile.firstName,
        profile.lastName,
        profile.displayName,
        profile.imageUrl,
      ]),
    )
    .digest("hex")
    .slice(0, 32);
  return `profile_${profile.sourceVersion}_${digest}`;
}

export function createProfileInvalidationOutboxEntry(
  profile: NewHireProfile,
  occurredAt: Date,
): ProfileInvalidationOutboxEntry {
  const event: ProfileInvalidationEvent = {
    version: OFFICE_EVENT_VERSION,
    type: "profile.invalidated",
    eventKey: createOfficeEventKey(
      "profile.invalidated",
      profileChangeSourceId(profile),
    ),
    occurredAt: occurredAt.toISOString(),
    profileId: profile.clerkUserId,
  };
  return { outboxId: event.eventKey, event };
}
