import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { profileFromIdentity } from "@/lib/onboarding/profile-authority";
import { normalizeProfileBatchIds } from "@/lib/profiles/domain";
import { projectAndPropagateProfile } from "@/lib/profiles/propagation";
import type {
  ProfileAttribution,
  ProfileInvalidationPublisher,
  ProfileProjectionResult,
  ProfileRepository,
} from "@/lib/profiles/types";

export function repairProfileProjection(
  repository: ProfileRepository,
  identity: AuthenticatedNewHire,
  publisher?: ProfileInvalidationPublisher,
): Promise<ProfileProjectionResult> {
  const profile = profileFromIdentity(identity);
  return publisher
    ? projectAndPropagateProfile({ repository, publisher, profile })
    : repository.projectProfile(profile);
}

export function readProfileBatch(
  repository: ProfileRepository,
  clerkUserIds: unknown,
): Promise<ProfileAttribution[]> {
  return repository.getProfiles(normalizeProfileBatchIds(clerkUserIds));
}
