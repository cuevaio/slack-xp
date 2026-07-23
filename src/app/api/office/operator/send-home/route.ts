import { createServiceAdapters } from "@/lib/adapters";
import { isOperatorUserId } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import {
  EmploymentActionError,
  type EmploymentPortalAuthority,
  type EmploymentRepository,
} from "@/lib/employment/contract";
import { parseSendHomeRequest } from "@/lib/employment/domain";
import { sendHomeNewHire } from "@/lib/employment/service";

export const runtime = "nodejs";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
} as const;

type SendHomeDependencies = {
  repository: EmploymentRepository;
  portal: EmploymentPortalAuthority;
  requesterId: string;
  operatorUserIds?: string;
  now?: Date;
};

export async function handleSendHomeRequest(
  request: Request,
  dependencies: SendHomeDependencies,
): Promise<Response> {
  if (
    !isOperatorUserId(dependencies.requesterId, dependencies.operatorUserIds)
  ) {
    return Response.json(
      { error: "operator_required" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  if (request.method !== "POST") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }
  const input = parseSendHomeRequest(await request.json().catch(() => null));
  if (!input) {
    return Response.json(
      { error: "invalid_send_home" },
      { status: 422, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const result = await sendHomeNewHire({
      repository: dependencies.repository,
      portal: dependencies.portal,
      operatorId: dependencies.requesterId,
      now: dependencies.now,
      ...input,
    });
    return Response.json(
      { ...result, expiresAt: result.expiresAt.toISOString() },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof EmploymentActionError) {
      const status = error.code === "request_conflict" ? 409 : 404;
      return Response.json(
        { error: error.code },
        { status, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
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
  return handleSendHomeRequest(request, {
    repository: adapters.neon,
    portal: adapters.portal,
    requesterId: identity.id,
    operatorUserIds: process.env.OPERATOR_CLERK_USER_IDS,
    now: new Date(),
  });
}
