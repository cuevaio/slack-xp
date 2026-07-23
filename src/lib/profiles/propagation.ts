import type { NewHireProfile } from "@/lib/onboarding/types";
import type {
  ProfileInvalidationPublisher,
  ProfileProjectionResult,
  ProfileRepository,
  ProjectProfileOptions,
} from "@/lib/profiles/types";

const PROFILE_OUTBOX_BATCH_SIZE = 50;

export async function flushProfileInvalidations(
  repository: ProfileRepository,
  publisher: ProfileInvalidationPublisher,
): Promise<number> {
  const pending = await repository.pendingProfileInvalidations(
    PROFILE_OUTBOX_BATCH_SIZE,
  );
  let published = 0;
  for (const entry of pending) {
    await publisher.publishProfileInvalidation(entry.event);
    await repository.markProfileInvalidationPublished(
      entry.outboxId,
      new Date(),
    );
    published += 1;
  }
  return published;
}

export async function projectAndPropagateProfile({
  repository,
  publisher,
  profile,
  options,
}: {
  repository: ProfileRepository;
  publisher: ProfileInvalidationPublisher;
  profile: NewHireProfile;
  options?: ProjectProfileOptions;
}): Promise<ProfileProjectionResult> {
  const result = await repository.projectProfile(profile, options);
  await flushProfileInvalidations(repository, publisher);
  return result;
}
