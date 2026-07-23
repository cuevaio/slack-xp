import type { NewHireProfile } from "@/lib/onboarding/types";
import type {
  DeletedClerkProfile,
  ProfileAttribution,
} from "@/lib/profiles/types";

export const UNAVAILABLE_PROFILE_NAME = "New Hire";
export const FORMER_EMPLOYEE_PROFILE_NAME = "Former Employee";
export const MAX_PROFILE_BATCH_SIZE = 100;

type ClerkProfilePayload = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string;
  updated_at: number;
};

export class InvalidClerkProfilePayloadError extends Error {
  constructor() {
    super("The Clerk profile webhook payload is invalid.");
    this.name = "InvalidClerkProfilePayloadError";
  }
}

export class ProfileBatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileBatchError";
  }
}

type ProfileAttributionSource = {
  displayName?: string | null;
  imageUrl?: string | null;
  deletedAt?: Date | null;
};

export function toProfileAttribution(
  clerkUserId: string,
  profile: ProfileAttributionSource | undefined,
): ProfileAttribution {
  if (profile?.deletedAt) {
    return {
      clerkUserId,
      displayName: FORMER_EMPLOYEE_PROFILE_NAME,
      imageUrl: null,
      status: "former",
    };
  }

  if (!profile?.displayName) {
    return {
      clerkUserId,
      displayName: UNAVAILABLE_PROFILE_NAME,
      imageUrl: null,
      status: "unavailable",
    };
  }

  return {
    clerkUserId,
    displayName: profile.displayName,
    imageUrl: profile.imageUrl ?? null,
    status: "current",
  };
}

export function deletedProfileFromClerkPayload(
  payload: unknown,
  signedTimestamp: unknown,
): DeletedClerkProfile {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("id" in payload) ||
    typeof payload.id !== "string" ||
    payload.id.length < 1 ||
    payload.id.length > 255 ||
    !("deleted" in payload) ||
    payload.deleted !== true ||
    typeof signedTimestamp !== "string" ||
    !/^\d{1,12}$/u.test(signedTimestamp)
  ) {
    throw new InvalidClerkProfilePayloadError();
  }

  const timestampSeconds = Number(signedTimestamp);
  const deletedAtMilliseconds = timestampSeconds * 1_000;
  // Clerk profile updates use millisecond source versions. Put a deletion at
  // the end of its signed second so an earlier same-second update cannot win.
  const sourceVersion = deletedAtMilliseconds + 999;
  if (
    !Number.isSafeInteger(sourceVersion) ||
    !Number.isFinite(new Date(deletedAtMilliseconds).getTime())
  ) {
    throw new InvalidClerkProfilePayloadError();
  }

  return {
    clerkUserId: payload.id,
    sourceVersion,
    deletedAt: new Date(deletedAtMilliseconds),
  };
}

export function profileFromClerkPayload(payload: unknown): NewHireProfile {
  if (!isClerkProfilePayload(payload)) {
    throw new InvalidClerkProfilePayloadError();
  }

  const suppliedFirstName = payload.first_name?.trim() ?? "";
  const suppliedLastName = payload.last_name?.trim() ?? "";
  const displayName =
    [suppliedFirstName, suppliedLastName].filter(Boolean).join(" ") ||
    UNAVAILABLE_PROFILE_NAME;
  if (displayName.length > 80) {
    throw new InvalidClerkProfilePayloadError();
  }

  // Onboarding requires a first-name-shaped field. If Clerk has only a last
  // name, retain the correct public display while avoiding an invalid row.
  const firstName =
    suppliedFirstName || suppliedLastName || UNAVAILABLE_PROFILE_NAME;
  const lastName = suppliedFirstName ? suppliedLastName : "";

  return {
    clerkUserId: payload.id,
    firstName,
    lastName,
    displayName,
    imageUrl: payload.image_url || null,
    sourceVersion: payload.updated_at,
  };
}

function isClerkProfilePayload(value: unknown): value is ClerkProfilePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<ClerkProfilePayload>;
  return (
    typeof payload.id === "string" &&
    payload.id.length >= 1 &&
    payload.id.length <= 255 &&
    (payload.first_name === null || typeof payload.first_name === "string") &&
    (payload.last_name === null || typeof payload.last_name === "string") &&
    typeof payload.image_url === "string" &&
    typeof payload.updated_at === "number" &&
    Number.isSafeInteger(payload.updated_at) &&
    payload.updated_at >= 0
  );
}

export function normalizeProfileBatchIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new ProfileBatchError("clerkUserIds must be an array.");
  }

  if (value.length > MAX_PROFILE_BATCH_SIZE) {
    throw new ProfileBatchError(
      `At most ${MAX_PROFILE_BATCH_SIZE} Clerk user IDs may be read at once.`,
    );
  }

  const uniqueIds = new Set<string>();
  for (const clerkUserId of value) {
    if (
      typeof clerkUserId !== "string" ||
      clerkUserId.length < 1 ||
      clerkUserId.length > 255 ||
      clerkUserId.trim() !== clerkUserId
    ) {
      throw new ProfileBatchError("Each Clerk user ID must be valid.");
    }
    uniqueIds.add(clerkUserId);
  }

  return [...uniqueIds];
}
