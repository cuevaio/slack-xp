import { createServiceAdapters } from "@/lib/adapters";
import { isOperatorUserId } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import type {
  HRReportInvalidationPublisher,
  HRReportRepository,
} from "@/lib/hr-reports/contract";
import { parseHRReportDismissalRequest } from "@/lib/hr-reports/domain";
import {
  dismissHRReport,
  HRReportReviewError,
  listHRReportsForReview,
} from "@/lib/hr-reports/service";

export const runtime = "nodejs";

type OperatorHRReportDependencies = {
  repository: HRReportRepository;
  clerkUserId: string;
  configuredUserIds?: string;
  appOrigin: string;
  now?: Date;
  publisher?: HRReportInvalidationPublisher;
};

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "no-store, private",
} as const;

export async function handleOperatorHRReportRequest(
  request: Request,
  dependencies: OperatorHRReportDependencies,
): Promise<Response> {
  if (
    !isOperatorUserId(dependencies.clerkUserId, dependencies.configuredUserIds)
  ) {
    return Response.json(
      { error: "operator_required" },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  if (request.method === "GET") {
    const reports = await listHRReportsForReview(dependencies);
    return Response.json({ reports }, { headers: PRIVATE_NO_STORE_HEADERS });
  }

  if (request.method !== "PATCH") {
    return Response.json(
      { error: "method_not_allowed" },
      { status: 405, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  const payload: unknown = await request.json().catch(() => null);
  const input = parseHRReportDismissalRequest(payload);
  if (!input) {
    return Response.json(
      { error: "invalid_hr_report_dismissal" },
      { status: 422, headers: PRIVATE_NO_STORE_HEADERS },
    );
  }

  try {
    const result = await dismissHRReport({
      repository: dependencies.repository,
      operatorId: dependencies.clerkUserId,
      publisher: dependencies.publisher,
      ...input,
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    return Response.json(
      { reportId: result.report.reportId, status: result.status },
      { headers: PRIVATE_NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HRReportReviewError) {
      return Response.json(
        { error: error.code },
        { status: 404, headers: PRIVATE_NO_STORE_HEADERS },
      );
    }
    throw error;
  }
}

async function handleAuthenticatedRequest(request: Request): Promise<Response> {
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

  return handleOperatorHRReportRequest(request, {
    repository: adapters.neon,
    clerkUserId: identity.id,
    configuredUserIds: process.env.OPERATOR_CLERK_USER_IDS,
    appOrigin: configuration.values.APP_ORIGIN ?? new URL(request.url).origin,
    publisher: adapters.portal,
  });
}

export function GET(request: Request) {
  return handleAuthenticatedRequest(request);
}

export function PATCH(request: Request) {
  return handleAuthenticatedRequest(request);
}
