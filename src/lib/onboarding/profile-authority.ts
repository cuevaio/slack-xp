import { clerkClient } from "@clerk/nextjs/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import { formatDisplayName, type ProfileInput } from "@/lib/onboarding/domain";
import type { NewHireProfile } from "@/lib/onboarding/types";
import { ProfileUpdateError } from "@/lib/profiles/edit";

const MOCK_PROFILE_AUTHORITY_KEY = Symbol.for(
  "portal-messenger.mock-profile-authority",
);

type MockAuthorityGlobal = typeof globalThis & {
  [MOCK_PROFILE_AUTHORITY_KEY]?: MockProfileAuthorityState;
};

type MockProfileAuthorityState = {
  profiles: Map<string, NewHireProfile>;
  nextFailure: "partial" | "reject" | null;
  nextProjectionDelay: number;
  projectionDelays: Map<string, number>;
};

function mockState(): MockProfileAuthorityState {
  const mockGlobal = globalThis as MockAuthorityGlobal;
  mockGlobal[MOCK_PROFILE_AUTHORITY_KEY] ??= {
    profiles: new Map(),
    nextFailure: null,
    nextProjectionDelay: 0,
    projectionDelays: new Map(),
  };
  return mockGlobal[MOCK_PROFILE_AUTHORITY_KEY];
}

function clerkFailure(error: unknown): ProfileUpdateError {
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

// Clerk is updated before this function returns a projection for Neon. A Clerk
// success followed by a Neon failure is safe to retry because authenticated
// entry repairs the projection from Clerk's current values.
export async function updateAuthoritativeProfile(
  configuration: ReadyAppConfiguration,
  identity: AuthenticatedNewHire,
  input: ProfileInput,
): Promise<NewHireProfile> {
  if (configuration.serviceMode === "mock") {
    const state = mockState();
    if (state.nextFailure === "reject") {
      state.nextFailure = null;
      throw new ProfileUpdateError(
        "profile_rejected",
        "Clerk did not accept those profile changes. Review the fields and retry.",
      );
    }
    const current =
      state.profiles.get(identity.id) ?? profileFromIdentity(identity);
    let imageUrl = current.imageUrl;
    const partiallyUpdate = state.nextFailure === "partial";
    if (input.image && !partiallyUpdate) {
      const bytes = Buffer.from(await input.image.arrayBuffer());
      imageUrl = `data:${input.image.type};base64,${bytes.toString("base64")}`;
    }
    const profile = {
      clerkUserId: identity.id,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: formatDisplayName(input.firstName, input.lastName),
      imageUrl,
      sourceVersion: Math.max(Date.now(), current.sourceVersion + 1),
    };
    state.profiles.set(identity.id, profile);
    state.projectionDelays.set(identity.id, state.nextProjectionDelay);
    state.nextProjectionDelay = 0;
    if (partiallyUpdate) {
      state.nextFailure = null;
      throw new ProfileUpdateError(
        "profile_partially_updated",
        "Clerk saved the name, but the picture was not confirmed. Retry to finish the Employee Record.",
      );
    }
    return profile;
  }

  const client = await clerkClient();
  let user: Awaited<ReturnType<typeof client.users.updateUser>>;
  try {
    user = await client.users.updateUser(identity.id, {
      firstName: input.firstName,
      lastName: input.lastName,
    });
  } catch (error) {
    throw clerkFailure(error);
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

export function readAuthoritativeProfile(
  configuration: ReadyAppConfiguration,
  identity: AuthenticatedNewHire,
): NewHireProfile {
  return configuration.serviceMode === "mock"
    ? (mockState().profiles.get(identity.id) ?? profileFromIdentity(identity))
    : profileFromIdentity(identity);
}

export function resetMockProfileAuthority(): void {
  const state = mockState();
  state.profiles.clear();
  state.projectionDelays.clear();
  state.nextFailure = null;
  state.nextProjectionDelay = 0;
}

export function failNextMockProfileUpdate(failure: "partial" | "reject"): void {
  mockState().nextFailure = failure;
}

export function delayNextMockProfileProjection(checks: number): void {
  mockState().nextProjectionDelay = Math.max(0, Math.floor(checks));
}

export function isMockProfileProjectionReady(clerkUserId: string): boolean {
  const state = mockState();
  const remaining = state.projectionDelays.get(clerkUserId) ?? 0;
  if (remaining <= 0) return true;
  state.projectionDelays.set(clerkUserId, remaining - 1);
  return false;
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
