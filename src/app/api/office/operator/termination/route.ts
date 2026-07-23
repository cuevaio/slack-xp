import { createServiceAdapters } from "@/lib/adapters";
import { isOperatorUserId } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import {
  EmploymentActionError,
  type EmploymentPortalAuthority,
  type EmploymentRepository,
} from "@/lib/employment/contract";
import {
  isEmploymentIdentifier,
  parseReinstatementRequest,
  parseTerminationRequest,
} from "@/lib/employment/domain";
import { reinstateNewHire, terminateNewHire } from "@/lib/employment/service";
import { officeNowForRequest } from "@/lib/portal/request-controls";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
} as const;

type TerminationDependencies = {
  repository: EmploymentRepository;
  portal: EmploymentPortalAuthority;
  requesterId: string;
  operatorUserIds?: string;
  now?: Date;
};

function forbidden(): Response {
  return Response.json(
    { error: "operator_required" },
    { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

function employmentError(error: EmploymentActionError): Response {
  const status = error.code === "request_conflict" ? 409 : 404;
  return Response.json(
    { error: error.code },
    { status, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

function invalidEmploymentAction(): Response {
  return Response.json(
    { error: "invalid_employment_action" },
    { status: 422, headers: PRIVATE_NO_STORE_HEADERS },
  );
}

export async function handleTerminationRequest(
  request: Request,
  dependencies: TerminationDependencies,
): Promise<Response> {
  if (
    !isOperatorUserId(dependencies.requesterId, dependencies.operatorUserIds)
  ) {
    return forbidden();
  }
  if (request.method === "GET") {
    const targetNewHireId = new URL(request.url).searchParams.get(
      "targetNewHireId",
    );
    if (!isEmploymentIdentifier(targetNewHireId)) {
      return Response.json(
        { error: "invalid_target" },
        { status: 422, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    const state = await dependencies.repository.getEmploymentState(
      targetNewHireId,
      dependencies.now ?? new Date(),
    );
    return Response.json(
      {
        access: {
          ...state.access,
          until: state.access.until?.toISOString() ?? null,
        },
        activeTermination: state.activeTermination
          ? {
              ...state.activeTermination,
              terminatedAt: state.activeTermination.terminatedAt.toISOString(),
            }
          : null,
      },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  if (request.method !== "POST" && request.method !== "PATCH") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const body = await request.json().catch(() => null);
  try {
    if (request.method === "POST") {
      const input = parseTerminationRequest(body);
      if (!input) return invalidEmploymentAction();
      const result = await terminateNewHire({
        repository: dependencies.repository,
        portal: dependencies.portal,
        operatorId: dependencies.requesterId,
        now: dependencies.now,
        ...input,
      });
      return Response.json(result, { headers: PRIVATE_NO_STORE_HEADERS });
    }

    const input = parseReinstatementRequest(body);
    if (!input) return invalidEmploymentAction();
    const result = await reinstateNewHire({
      repository: dependencies.repository,
      portal: dependencies.portal,
      operatorId: dependencies.requesterId,
      now: dependencies.now,
      ...input,
    });
    return Response.json(result, { headers: PRIVATE_NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof EmploymentActionError) return employmentError(error);
    throw error;
  }
}

async function route(request: Request): Promise<Response> {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json(
      { error: "authentication_required" },
      { status: 401, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const adapters = createServiceAdapters(configuration);
  const onboarding = await adapters.neon.getNewHire(identity.id);
  if (!onboarding?.completedAt || onboarding.step !== "complete") {
    return Response.json(
      { error: "new_hire_ineligible" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  return handleTerminationRequest(request, {
    repository: adapters.neon,
    portal: adapters.portal,
    requesterId: identity.id,
    operatorUserIds: process.env.OPERATOR_CLERK_USER_IDS,
    now: officeNowForRequest(request.headers, configuration),
  });
}

export const GET = route;
export const POST = route;
export const PATCH = route;
