import { createServiceAdapters, type NeonAdapter } from "@/lib/adapters";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import type { AuthenticatedNewHire } from "@/lib/auth/types";
import { type ReadyAppConfiguration, readAppConfiguration } from "@/lib/config";
import {
  OnboardingError,
  type ProfileInput,
  validateProfileInput,
} from "@/lib/onboarding/domain";
import {
  isMockProfileProjectionReady,
  profileFromIdentity,
  readAuthoritativeProfile,
  updateAuthoritativeProfile,
} from "@/lib/onboarding/profile-authority";
import type { NewHireProfile } from "@/lib/onboarding/types";
import {
  ProfileUpdateError,
  readEmployeeRecordProjection,
  repairEmployeeRecordProjection,
  updateEmployeeRecord,
} from "@/lib/profiles/edit";

export const runtime = "nodejs";

type EmployeeRecordDependencies = {
  configuration: ReadyAppConfiguration;
  identity: AuthenticatedNewHire;
  repository: NeonAdapter;
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

function errorResponse(error: unknown): Response | null {
  if (error instanceof OnboardingError) {
    return Response.json(
      {
        error: error.code,
        message: error.message,
        ...(error.field
          ? { fieldErrors: { [error.field]: error.message } }
          : {}),
      },
      { status: 422 },
    );
  }
  if (error instanceof ProfileUpdateError) {
    const status =
      error.code === "profile_rejected"
        ? 422
        : error.code === "profile_update_timed_out"
          ? 504
          : error.code === "profile_partially_updated"
            ? 409
            : 503;
    return Response.json(
      { error: error.code, message: error.message },
      { status },
    );
  }
  return null;
}

export async function handleEmployeeRecordUpdate(
  request: Request,
  dependencies: EmployeeRecordDependencies,
): Promise<Response> {
  try {
    const { configuration, identity, repository } = dependencies;
    const onboarding = await repository.enterNewHire(
      profileFromIdentity(identity),
    );
    const input = readValidatedProfileInput(await request.formData());
    const result = await updateEmployeeRecord({
      repository,
      updateAuthority: () =>
        dependencies.updateAuthority
          ? dependencies.updateAuthority(input)
          : updateAuthoritativeProfile(configuration, identity, input),
      ...(onboarding.step === "profile"
        ? {
            onAuthorityConfirmed: (clerkUserId: string) =>
              repository.confirmProfile(clerkUserId),
          }
        : {}),
      ...(dependencies.timeoutMs === undefined
        ? {}
        : { timeoutMs: dependencies.timeoutMs }),
    });
    return Response.json(result);
  } catch (error) {
    const response = errorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function handleEmployeeRecordConvergence(
  dependencies: Omit<
    EmployeeRecordDependencies,
    "updateAuthority" | "timeoutMs"
  >,
): Promise<Response> {
  try {
    const authoritativeProfile = readAuthoritativeProfile(
      dependencies.configuration,
      dependencies.identity,
    );
    if (
      dependencies.configuration.serviceMode === "mock" &&
      !isMockProfileProjectionReady(authoritativeProfile.clerkUserId)
    ) {
      return Response.json(
        await readEmployeeRecordProjection(
          dependencies.repository,
          authoritativeProfile,
        ),
      );
    }
    return Response.json(
      await repairEmployeeRecordProjection(
        dependencies.repository,
        authoritativeProfile,
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

async function authenticatedDependencies(): Promise<
  EmployeeRecordDependencies | Response
> {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  return {
    configuration,
    identity,
    repository: createServiceAdapters(configuration).neon,
  };
}

export async function GET() {
  const dependencies = await authenticatedDependencies();
  return dependencies instanceof Response
    ? dependencies
    : handleEmployeeRecordConvergence(dependencies);
}

export async function POST(request: Request) {
  const dependencies = await authenticatedDependencies();
  return dependencies instanceof Response
    ? dependencies
    : handleEmployeeRecordUpdate(request, dependencies);
}
