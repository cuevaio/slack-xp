import { clerkClient } from "@clerk/nextjs/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { formatDisplayName, type ProfileInput } from "@/lib/onboarding/domain";
import type { NewHireProfile } from "@/lib/onboarding/types";

// Clerk is updated before this function returns a projection for Neon. A Clerk
// success followed by a Neon failure is safe to retry because authenticated
// entry repairs the projection from Clerk's current values.
export async function updateAuthoritativeProfile(
  configuration: ReadyAppConfiguration,
  identity: AuthenticatedNewHire,
  input: ProfileInput,
): Promise<NewHireProfile> {
  if (configuration.serviceMode === "mock") {
    let imageUrl = identity.imageUrl;
    if (input.image) {
      const bytes = Buffer.from(await input.image.arrayBuffer());
      imageUrl = `data:${input.image.type};base64,${bytes.toString("base64")}`;
    }
    return {
      clerkUserId: identity.id,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: formatDisplayName(input.firstName, input.lastName),
      imageUrl,
      sourceVersion: Date.now(),
    };
  }

  const client = await clerkClient();
  let user = await client.users.updateUser(identity.id, {
    firstName: input.firstName,
    lastName: input.lastName,
  });
  if (input.image) {
    user = await client.users.updateUserProfileImage(identity.id, {
      file: input.image,
    });
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
