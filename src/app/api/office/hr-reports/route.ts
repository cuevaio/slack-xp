import { createServiceAdapters } from "@/lib/adapters";
import { configuredOperatorUserIds } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import {
  parseMessageHRReportRequest,
  parseProfileHRReportRequest,
} from "@/lib/hr-reports/domain";
import {
  submitMessageHRReport,
  submitProfileHRReport,
} from "@/lib/hr-reports/service";
import { officeNowForRequest } from "@/lib/portal/request-time";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuration = readAppConfiguration();
  if (configuration.status === "incomplete") {
    return Response.json({ error: "installation_incomplete" }, { status: 503 });
  }
  const identity = await authenticateOfficeRequest(configuration);
  if (!identity) {
    return Response.json({ error: "authentication_required" }, { status: 401 });
  }
  const adapters = createServiceAdapters(configuration);
  const onboarding = await adapters.neon.getNewHire(identity.id);
  if (!onboarding?.completedAt || onboarding.step !== "complete") {
    return Response.json({ error: "new_hire_ineligible" }, { status: 403 });
  }

  const now = officeNowForRequest(request.headers, configuration);
  const body: unknown = await request.json().catch(() => null);
  const input =
    parseProfileHRReportRequest(body) ?? parseMessageHRReportRequest(body, now);
  if (!input) {
    return Response.json({ error: "invalid_hr_report" }, { status: 422 });
  }
  const operatorIds =
    configuration.serviceMode === "mock"
      ? ["user_mock_operator"]
      : configuredOperatorUserIds();
  const dependencies = {
    repository: adapters.neon,
    publisher: adapters.portal,
    reporterId: identity.id,
    operatorIds,
    appOrigin: configuration.values.APP_ORIGIN ?? new URL(request.url).origin,
    now,
  };
  let result: Awaited<ReturnType<typeof submitMessageHRReport>>;
  if ("subjectType" in input) {
    const [profile] = await adapters.neon.getProfiles([input.profileId]);
    if (profile?.status !== "current") {
      return Response.json({ error: "profile_unavailable" }, { status: 422 });
    }
    result = await submitProfileHRReport({ ...dependencies, ...input });
  } else {
    result = await submitMessageHRReport({ ...dependencies, ...input });
  }
  return Response.json(result, {
    status: result.status === "created" ? 201 : 200,
    headers: { "Cache-Control": "no-store, private" },
  });
}
