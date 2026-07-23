import { clerkClient } from "@clerk/nextjs/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { formatDisplayName, type ProfileInput } from "@/lib/onboarding/domain";
import type { NewHireProfile } from "@/lib/onboarding/types";
import { ProfileUpdateError } from "@/lib/profiles/edit";

function profileUpdateFailureFromClerk(error: unknown): ProfileUpdateError {
  let status: number | undefined;
  if (error && typeof error === "object" && "status" in error) {
    status = Number(error.status);
  }
  if (status && status >= 400 && status < 500) {
    return new ProfileUpdateError(
      "profile_rejected",
      "Clerk did not accept those profile changes. Review the fields and retry.",
    );
  }
  return new ProfileUpdateError(
    "profile_update_unavailable",
    "Clerk is temporarily unavailable. Your entries are ready to retry.",
  );
}

async function updateClerkProfile(
  identity: AuthenticatedNewHire,
  input: ProfileInput,
): Promise<NewHireProfile> {
  const client = await clerkClient();
  let user: Awaited<ReturnType<typeof client.users.updateUser>>;
  try {
    user = await client.users.updateUser(identity.id, {
      firstName: input.firstName,
      lastName: input.lastName,
    });
  } catch (error) {
    throw profileUpdateFailureFromClerk(error);
  }

  if (input.image) {
    try {
      user = await client.users.updateUserProfileImage(identity.id, {
        file: input.image,
      });
    } catch {
      throw new ProfileUpdateError(
        "profile_partially_updated",
        "Clerk saved the name, but the picture was not confirmed. Retry to finish the Employee Record.",
      );
    }
  }

  const firstName = user.firstName ?? input.firstName;
  const lastName = user.lastName ?? input.lastName;
  return {
    clerkUserId: user.id,
    firstName,
    lastName,
    displayName: user.fullName ?? formatDisplayName(firstName, lastName),
    imageUrl: user.imageUrl || null,
    sourceVersion: user.updatedAt,
  };
}

// Returning the profile only after Clerk confirms it keeps Neon downstream of
// the authority. Authenticated entry repairs any later projection failure.
export function updateAuthoritativeProfile(
  _configuration: ReadyAppConfiguration,
  identity: AuthenticatedNewHire,
  input: ProfileInput,
): Promise<NewHireProfile> {
  return updateClerkProfile(identity, input);
}

export function readAuthoritativeProfile(
  _configuration: ReadyAppConfiguration,
  identity: AuthenticatedNewHire,
): NewHireProfile {
  return profileFromIdentity(identity);
}

export function profileFromIdentity(
  identity: AuthenticatedNewHire,
): NewHireProfile {
  return {
    clerkUserId: identity.id,
    firstName: identity.firstName,
    lastName: identity.lastName,
    displayName: identity.fullName,
    imageUrl: identity.imageUrl,
    sourceVersion: identity.sourceVersion,
  };
}
