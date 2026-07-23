import type { NeonAdapter } from "@/lib/adapters";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import type { ReadyAppConfiguration } from "@/lib/config";
import {
  OnboardingError,
  type ProfileInput,
  validateProfileInput,
} from "@/lib/onboarding/domain";
import {
  profileFromIdentity,
  readAuthoritativeProfile,
  updateAuthoritativeProfile,
} from "@/lib/onboarding/profile-authority";
import type { NewHireProfile } from "@/lib/onboarding/types";
import {
  ProfileUpdateError,
  repairEmployeeRecordProjection,
  updateEmployeeRecord,
} from "@/lib/profiles/edit";
import type { ProfileInvalidationPublisher } from "@/lib/profiles/types";

export type EmployeeRecordDependencies = {
  configuration: ReadyAppConfiguration;
  identity: AuthenticatedNewHire;
  repository: NeonAdapter;
  publisher?: ProfileInvalidationPublisher;
};

type EmployeeRecordUpdateDependencies = EmployeeRecordDependencies & {
  updateAuthority?: (input: ProfileInput) => Promise<NewHireProfile>;
  timeoutMs?: number;
};

function readValidatedProfileInput(formData: FormData): ProfileInput {
  const imageEntry = formData.get("image");
  const image =
    imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
  const names = validateProfileInput({
    firstName: String(formData.get("firstName") ?? ""),
    lastName: String(formData.get("lastName") ?? ""),
    image,
  });

  return { ...names, image };
}

function profileUpdateErrorStatus(error: ProfileUpdateError): number {
  switch (error.code) {
    case "profile_rejected":
      return 422;
    case "profile_update_timed_out":
      return 504;
    case "profile_partially_updated":
      return 409;
    case "profile_confirmation_unavailable":
    case "profile_projection_unavailable":
    case "profile_update_unavailable":
      return 503;
  }
}

function employeeRecordErrorResponse(error: unknown): Response | null {
  if (error instanceof OnboardingError) {
    const fieldErrors = error.field
      ? { [error.field]: error.message }
      : undefined;

    return Response.json(
      {
        error: error.code,
        message: error.message,
        ...(fieldErrors ? { fieldErrors } : {}),
      },
      { status: 422 },
    );
  }

  if (error instanceof ProfileUpdateError) {
    return Response.json(
      { error: error.code, message: error.message },
      { status: profileUpdateErrorStatus(error) },
    );
  }

  return null;
}

export async function handleEmployeeRecordUpdate(
  formData: FormData,
  dependencies: EmployeeRecordUpdateDependencies,
): Promise<Response> {
  try {
    const { configuration, identity, repository } = dependencies;
    const onboarding = await repository.enterNewHire(
      profileFromIdentity(identity),
    );
    const input = readValidatedProfileInput(formData);
    const customUpdateAuthority = dependencies.updateAuthority;
    const onAuthorityConfirmed =
      onboarding.step === "profile"
        ? (clerkUserId: string) => repository.confirmProfile(clerkUserId)
        : undefined;

    const result = await updateEmployeeRecord({
      repository,
      updateAuthority: () =>
        customUpdateAuthority
          ? customUpdateAuthority(input)
          : updateAuthoritativeProfile(configuration, identity, input),
      onAuthorityConfirmed,
      timeoutMs: dependencies.timeoutMs,
    });
    return Response.json(result);
  } catch (error) {
    const response = employeeRecordErrorResponse(error);
    if (response) {
      return response;
    }
    throw error;
  }
}

export async function handleEmployeeRecordConvergence(
  dependencies: EmployeeRecordDependencies,
): Promise<Response> {
  try {
    const authoritativeProfile = readAuthoritativeProfile(
      dependencies.configuration,
      dependencies.identity,
    );
    return Response.json(
      await repairEmployeeRecordProjection(
        dependencies.repository,
        authoritativeProfile,
        dependencies.publisher,
      ),
    );
  } catch {
    return Response.json(
      {
        error: "profile_projection_unavailable",
        message:
          "The Shared Public Office has not confirmed the Clerk changes yet. Check again shortly.",
      },
      { status: 503 },
    );
  }
}
