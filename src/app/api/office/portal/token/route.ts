import { createServiceAdapters } from "@/lib/adapters";
import { configuredOperatorUserIds } from "@/lib/auth/operator";
import { authenticateOfficeRequest } from "@/lib/auth/server";
import { readAppConfiguration } from "@/lib/config";
import { flushHRReportNotifications } from "@/lib/hr-reports/service";
import { MockPortalUnavailableError } from "@/lib/portal/mock";
import { officeNowForRequest } from "@/lib/portal/request-time";
import { PortalServiceError } from "@/lib/portal/server";
import {
  issueOfficePortalSession,
  PortalEligibilityError,
} from "@/lib/portal/session";
import { flushProfileInvalidations } from "@/lib/profiles/propagation";

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
  try {
    await flushProfileInvalidations(adapters.neon, adapters.portal);
    try {
      await flushHRReportNotifications({
        repository: adapters.neon,
        publisher: adapters.portal,
        operatorIds:
          configuration.serviceMode === "mock"
            ? ["user_mock_operator"]
            : configuredOperatorUserIds(),
        appOrigin:
          configuration.values.APP_ORIGIN ?? new URL(request.url).origin,
      });
    } catch {
      console.error(
        JSON.stringify({
          operation: "hr_report_notification_retry",
          authority: "portal",
          status: "pending",
        }),
      );
    }
    const session = await issueOfficePortalSession({
      identity,
      onboarding: await adapters.neon.getNewHire(identity.id),
      now: officeNowForRequest(request.headers, configuration),
      portal: adapters.portal,
    });
    return Response.json(session, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    if (error instanceof PortalEligibilityError) {
      return Response.json({ error: "new_hire_ineligible" }, { status: 403 });
    }
    if (error instanceof PortalServiceError) {
      console.error(
        JSON.stringify({
          operation: "portal_session",
          authority: "portal",
          code: error.code,
          status: error.status,
        }),
      );
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    if (error instanceof MockPortalUnavailableError) {
      return Response.json({ error: "portal_unavailable" }, { status: 503 });
    }
    throw error;
  }
}
