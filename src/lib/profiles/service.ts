import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { profileFromIdentity } from "@/lib/onboarding/profile-authority";
import { normalizeProfileBatchIds } from "@/lib/profiles/domain";
import type {
  ProfileAttribution,
  ProfileProjectionResult,
  ProfileRepository,
} from "@/lib/profiles/types";

export function repairProfileProjection(
  repository: ProfileRepository,
  identity: AuthenticatedNewHire,
): Promise<ProfileProjectionResult> {
  return repository.projectProfile(profileFromIdentity(identity));
}

export function readProfileBatch(
  repository: ProfileRepository,
  clerkUserIds: unknown,
): Promise<ProfileAttribution[]> {
  return repository.getProfiles(normalizeProfileBatchIds(clerkUserIds));
}
